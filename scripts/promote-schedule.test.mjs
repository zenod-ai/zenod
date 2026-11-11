// EPIC-24 M12: the hourly promote tick (scripts/promote-schedule/tick.py) decides right, with every outside
// call (VPS1 probe, staging/production health, the promote script, the desk note) faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const tick = join(dirname(fileURLToPath(import.meta.url)), 'promote-schedule', 'tick.py');
const A = 'a'.repeat(40), B = 'b'.repeat(40);

function setup({ staging = B, prod = A, prodStatus = 'ok', paused = false, rolledAt = '2026-11-11T10:00:00Z',
  log = [], promotions = [], flag = false, promoteExit = 0, promoteWrites = null } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'm12-'));
  const ev = join(d, 'eval');
  spawnSync('mkdir', ['-p', ev]);
  writeFileSync(join(d, 'staging.json'), JSON.stringify({ status: 'ok', sha: staging }));
  writeFileSync(join(d, 'prod.json'), JSON.stringify({ status: prodStatus, sha: prod }));
  writeFileSync(join(d, 'probe.json'), JSON.stringify({ promote_paused: paused, staging: { sha: staging, at: rolledAt } }));
  if (log.length) writeFileSync(join(ev, 'promote-schedule.jsonl'), log.map((x) => JSON.stringify(x)).join('\n') + '\n');
  if (promotions.length) writeFileSync(join(ev, 'promotions.jsonl'), promotions.map((x) => JSON.stringify(x)).join('\n') + '\n');
  if (flag) writeFileSync(join(ev, 'promote-now'), '');
  const promote = join(d, 'promote.sh');
  writeFileSync(promote, `#!/bin/bash\necho "$@" > ${d}/promote-args\n${promoteWrites ? `echo '${JSON.stringify(promoteWrites)}' >> ${ev}/promotions.jsonl\n` : ''}echo gate output\nexit ${promoteExit}\n`);
  const notify = join(d, 'notify.sh');
  writeFileSync(notify, `#!/bin/bash\necho "$1" >> ${d}/notes\n`);
  return { d, ev, env: {
    ...process.env, ZENOD_EVAL: ev,
    ZENOD_STAGING_URL: `file://${d}/staging-dir`, ZENOD_PROD_HEALTH: `file://${d}/prod.json`,
    ZENOD_TICK_VPS1_CMD: `cat ${d}/probe.json`, ZENOD_TICK_PROMOTE_CMD: `bash ${promote}`, ZENOD_TICK_NOTIFY_CMD: `bash ${notify}`,
  } };
}

function run(s, now, ...args) {
  spawnSync('mkdir', ['-p', join(s.d, 'staging-dir', 'api')]);
  spawnSync('cp', [join(s.d, 'staging.json'), join(s.d, 'staging-dir', 'api', 'health')]);
  const r = spawnSync('python3', [tick, ...args], { env: { ...s.env, ZENOD_TICK_NOW: now }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// 2026-11-11T13:00Z is 14:00 in Madrid (day); 23:30Z is 00:30 (quiet).
const DAY = '2026-11-11T13:00:00Z', NIGHT = '2026-11-11T23:30:00Z';

test('nothing new when staging runs production\'s sha', () => {
  assert.equal(run(setup({ staging: A }), DAY).decision, 'nothing-new');
});

test('quiet hours skip, unless a fix is waiting', () => {
  assert.equal(run(setup(), NIGHT).decision, 'quiet-hours');
  const s = setup({ flag: true, promoteWrites: { at: NIGHT, action: 'promote', sha: B } });
  const r = run(s, NIGHT);
  assert.equal(r.decision, 'promoted');
  assert.equal(r.fix_waiting, 'promote-now flag');
  assert.equal(existsSync(join(s.ev, 'promote-now')), false, 'the flag is consumed');
  assert.equal(run(setup({ prodStatus: 'degraded' }), NIGHT, '--dry-run').decision, 'would-run');
});

test('infra-vps pause stops it', () => {
  assert.equal(run(setup({ paused: true }), DAY).decision, 'paused');
  assert.equal(run(setup({ paused: true }), DAY, '--dry-run', '--assume-unpaused').decision, 'would-run');
});

test('batching: staging must hold the sha for 30 minutes', () => {
  const r = run(setup({ rolledAt: '2026-11-11T12:45:00Z' }), DAY);
  assert.equal(r.decision, 'batching');
  assert.equal(r.age_min, 15);
});

test('at most one promote or gate run per hour', () => {
  assert.equal(run(setup({ promotions: [{ at: '2026-11-11T12:20:00Z', action: 'promote', sha: A }] }), DAY).decision, 'hourly-limit');
  assert.equal(run(setup({ log: [{ at: '2026-11-11T12:30:00Z', sha: A, decision: 'gate-failed', gate_ran: true }] }), DAY).decision, 'hourly-limit');
  assert.equal(run(setup({ promotions: [{ at: '2026-11-11T11:50:00Z', action: 'promote', sha: A }] }), DAY, '--dry-run').decision, 'would-run');
});

test('a gate failure stops, tells the Delivery Manager once, and is not retried within 6 h', () => {
  const s = setup({ promoteExit: 1 });
  const r = run(s, DAY);
  assert.equal(r.decision, 'gate-failed');
  assert.equal(r.told, 'desk note to the Delivery Manager');
  assert.match(readFileSync(join(s.d, 'notes'), 'utf8'), /gate-failed on staging bbbbbbb/);
  assert.match(readFileSync(join(s.d, 'promote-args'), 'utf8'), new RegExp(`--sha ${B}`));
  assert.equal(run(s, '2026-11-11T14:10:00Z').decision, 'gate-failed-earlier');
  const again = run(s, '2026-11-11T19:10:00Z');
  assert.equal(again.decision, 'gate-failed');
  assert.equal(again.told, undefined, 'one note per sha');
  assert.equal(readFileSync(join(s.d, 'notes'), 'utf8').trim().split('\n').length, 1);
});

test('a promote that the poller rolled back is promote-failed', () => {
  const r = run(setup({ promoteExit: 1, promoteWrites: { at: DAY, action: 'failed', sha: B } }), DAY);
  assert.equal(r.decision, 'promote-failed');
});

test('dry run writes nothing; a real tick writes one line', () => {
  const s = setup();
  assert.equal(run(s, DAY, '--dry-run').decision, 'would-run');
  assert.equal(existsSync(join(s.ev, 'promote-schedule.jsonl')), false);
  assert.equal(existsSync(join(s.d, 'promote-args')), false, 'dry run never runs the gate');
  run(setup({ staging: A }), DAY);
  const s2 = setup({ staging: A }); run(s2, DAY);
  assert.equal(readFileSync(join(s2.ev, 'promote-schedule.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('VPS1 unreachable: skip, pause state unknown', () => {
  const s = setup();
  s.env.ZENOD_TICK_VPS1_CMD = 'false';
  assert.equal(run(s, DAY).decision, 'vps1-unreachable');
});

test('production unreadable: never promote blind', () => {
  const s = setup();
  s.env.ZENOD_PROD_HEALTH = `file://${s.d}/missing.json`;
  assert.equal(run(s, DAY).decision, 'production-unreadable');
});
