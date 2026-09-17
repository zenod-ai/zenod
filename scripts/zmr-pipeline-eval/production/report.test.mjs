import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const collect = fileURLToPath(new URL('./collect.mjs', import.meta.url));
const report = fileURLToPath(new URL('./report.mjs', import.meta.url));

test('collect then report renders expected-vs-actual, cost, tokens and score', () => {
  const root = mkdtempSync(join(tmpdir(), 'm2-report-'));
  try {
    const cellDir = join(root, 'cells', 'B01-1');
    mkdirSync(cellDir, {recursive: true});
    const models = {model_classify: 'openai/gpt-5.6-luna', model_classify_reasoning_effort: 'low', model_ask: 'openai/gpt-5.6-luna', model_ask_reasoning_effort: 'low'};
    writeFileSync(join(cellDir, 'operator-receipt.json'), JSON.stringify({
      calls: [{name: 'chat_with_zenod', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:02.000Z'}],
      cost: {reservedExposureUsd: 0.25},
      run: {outcomes: [{id: 'B01', trial: 1, key: 'B01:1', status: 'RECORDED', latencyMs: 2500, gates: {isolation: true},
        turns: [{message: 'Please save this memory', thread: 'main', result: {text: 'Saved the original note. 18 November 2026 14:30 KILN-47'}}], captures: []}]},
    }));
    writeFileSync(join(cellDir, 'manifest.json'), JSON.stringify({models}));
    writeFileSync(join(cellDir, 'usage.json'), JSON.stringify({available: true,
      byOperation: [{operation: 'answer', model: 'openai/gpt-5.6-luna', calls: 1, inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0, costUsd: 0.012345}],
      calls: [], totals: {calls: 1, inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0, costUsd: 0.012345}}));

    const meta = join(root, 'meta.json');
    writeFileSync(meta, JSON.stringify({runId: 'test-run', candidateSha: 'a'.repeat(40), imageDigest: 'sha256:' + 'b'.repeat(64), models, deployment: {provider: 'Dokploy', deploymentId: 'dep-1', title: 'test'}}));
    const reviews = join(root, 'reviews.json');
    writeFileSync(reviews, JSON.stringify({'B01:1': {verdict: 'PASS', rationale: 'literal retained', checks: [{status: 'PASS', text: 'Durable source unchanged', evidence: 'raw log'}]}}));
    const runOut = join(root, 'run.json');
    execFileSync('node', [collect, '--cells', join(root, 'cells'), '--meta', meta, '--reviews', reviews, '--out', runOut]);
    const run = JSON.parse(readFileSync(runOut, 'utf8'));
    assert.equal(run.totals.actualUsd, 0.012345);
    assert.equal(run.totals.pass, 1);
    assert.equal(run.cells[0].usage.totals.calls, 1);

    const htmlOut = join(root, 'report.html');
    execFileSync('node', [report, '--runs', runOut, '--out', htmlOut]);
    const html = readFileSync(htmlOut, 'utf8');
    for (const needle of ['B01:1', '18 November 2026', 'KILN-47', '$0.012345', 'openai/gpt-5.6-luna', 'Saved the original note', 'PASS', 'Durable source unchanged']) {
      assert.ok(html.includes(needle), `report missing: ${needle}`);
    }
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
