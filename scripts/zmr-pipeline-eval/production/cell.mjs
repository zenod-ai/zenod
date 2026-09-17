// In-container driver for one production MCP cell, bound to a deployed snapshot.
// The caller (host launcher) supplies the exact code snapshot (candidateSha /
// imageDigest) and the exact model snapshot from the live owner settings; the
// disposable test tenant is configured to those models and the manifest carries
// them, so the receipt describes the deployed product configuration.
// Secrets (github + tenant token, provider key) stay in memory; never logged.
import {readFileSync,writeFileSync,chmodSync,existsSync,mkdirSync,rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {validateModelSnapshot} from './snapshot.mjs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const p = input.remote;
const sha = input.identity.candidateSha;
const digest = input.identity.imageDigest;
const models = validateModelSnapshot(input.models);
const hash = (x) => createHash('sha256').update(x).digest('hex');
const secrets = [input.githubToken];
const save = (name, data) => {
  const text = JSON.stringify(data, null, 2);
  if (secrets.some((s) => s && text.includes(s))) throw Error('secret_write_refused');
  writeFileSync(join(p, name), text + '\n', {mode: 0o600});
  chmodSync(join(p, name), 0o600);
};
/** Actual LLM usage for this cell from the tenant's durable usage ledger. */
function readTenantUsage(id) {
  const path = join('/data', id, 'usage.sqlite');
  if (!existsSync(path)) return {available: false};
  const d = new DatabaseSync(path, {readOnly: true});
  try {
    const byOperation = d.prepare("SELECT operation,model,COUNT(*) calls,SUM(input_tokens) inputTokens,SUM(output_tokens) outputTokens,SUM(cached_input_tokens) cachedInputTokens,SUM(cost_usd) costUsd,SUM(provider_cost_usd) providerCostUsd,MIN(ts) firstTs,MAX(ts) lastTs FROM llm_usage GROUP BY operation,model ORDER BY operation,model").all();
    const calls = d.prepare("SELECT ts,operation,model,input_tokens inputTokens,output_tokens outputTokens,cached_input_tokens cachedInputTokens,cost_usd costUsd,provider_cost_usd providerCostUsd,generation_id generationId,status FROM llm_usage ORDER BY ts").all();
    const totals = byOperation.reduce((acc, r) => ({
      calls: acc.calls + r.calls,
      inputTokens: acc.inputTokens + (r.inputTokens || 0),
      outputTokens: acc.outputTokens + (r.outputTokens || 0),
      cachedInputTokens: acc.cachedInputTokens + (r.cachedInputTokens || 0),
      costUsd: acc.costUsd + (r.costUsd || 0),
      providerCostUsd: acc.providerCostUsd + (r.providerCostUsd || 0),
    }), {calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0, providerCostUsd: 0});
    return {available: true, byOperation, calls, totals};
  } finally { d.close(); }
}
const moduleBase = join(p, 'scripts/zmr-pipeline-eval/production');
const {createOperator} = await import(pathToFileURL(join(moduleBase, 'operator.mjs')));
const {runProductionCase} = await import(pathToFileURL(join(moduleBase, 'runner.mjs')));
const f = readFileSync(join(p, 'scripts/zmr-pipeline-eval/basics/fixture.json'));
const rub = readFileSync(join(p, 'scripts/zmr-pipeline-eval/basics/rubric.json'));
let step = 'identity', tenantToken, m, io, uncertain = false, completed = false;
const ro = new DatabaseSync('/data/chassis-tenants.sqlite', {readOnly: true});
const tenantId = input.identity.tenantId;
const ownerSnapshot = () => Object.fromEntries(['github-63050995', 'jordiepic32test-5oqq39', 'jordiepic32clean-ml7rz0'].map((id) => {
  const path = join('/data', id, 'zenod.sqlite');
  if (!existsSync(path)) return [id, {absent: true}];
  const d = new DatabaseSync(path, {readOnly: true});
  const settingsHash = hash(JSON.stringify(d.prepare('SELECT key,value FROM settings ORDER BY key').all()));
  d.close();
  let head = null;
  try { head = execFileSync('git', ['-C', join('/data', id, 'vault'), 'rev-parse', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim(); } catch {}
  return [id, {settingsHash, head}];
}));
const baseline = ownerSnapshot();
save('protected-targets-before.json', baseline);
const api = async (path, method = 'GET', body) => {
  let response;
  try {
    response = await fetch('https://cloud.zenod.dev' + path, {
      method,
      headers: { ...(tenantToken ? {Authorization: `Bearer ${tenantToken}`} : {}), ...(body ? {'Content-Type': 'application/json'} : {}) },
      ...(body ? {body: JSON.stringify(body)} : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(90000),
    });
  } catch { uncertain = true; throw Error('http_uncertain'); }
  if (!response.ok) { await response.arrayBuffer(); throw Error('http_' + response.status); }
  return response.json();
};
try {
  if (process.env.GIT_SHA !== sha) throw Error('wrong_source');
  const health = await api('/api/health');
  if (health.sha !== sha) throw Error('wrong_public_source');
  save('health-before.json', health);
  const moduleHashes = {};
  for (const rel of ['packages/mcp-chassis/dist/sqliteTenantStore.js', 'packages/server/dist/zenodUnit.js', 'packages/server/dist/taskJobQueue.js', 'packages/server/dist/settings.js', 'packages/core/dist/vault/lint.js']) moduleHashes[rel] = hash(readFileSync(join('/app', rel)));
  if (ro.prepare('SELECT 1 FROM tenants WHERE tenant_id=?').get(tenantId)) throw Error('tenant_collision');
  step = 'provision';
  const {SqliteTenantStore} = await import('/app/packages/mcp-chassis/dist/sqliteTenantStore.js');
  const ts = new SqliteTenantStore({path: '/data/chassis-tenants.sqlite'});
  const created = ts.provisionTenant({tenantId, name: 'M2 ' + input.caseKey + ' synthetic', status: 'active', expiresAt: Date.now() + 3600000});
  tenantToken = created.token;
  secrets.push(tenantToken);
  ts.close();
  const row = ro.prepare('SELECT tenant_id,created_at,token_hash,expires_at,status FROM tenants WHERE tenant_id=?').get(tenantId);
  if (!row || row.expires_at <= Date.now() || row.token_hash !== hash(tenantToken)) throw Error('tenant_creation_mismatch');
  save('tenant-owned.json', row);
  m = {
    version: 1, origin: 'https://cloud.zenod.dev', key: input.caseKey, candidateSha: sha, imageDigest: digest,
    observedRelease: {sourceSha: sha, imageDigest: digest, checkedAt: Date.now()},
    tenant: {id: tenantId, createdAt: row.created_at, tokenHash: row.token_hash},
    repo: {id: input.repo.id, owner: 'AlfaBlok', name: input.repo.name, private: true, createdAt: input.repo.created_at},
    fixtureSha256: hash(f), rubricSha256: hash(rub), seedCommit: input.seed.seedCommit,
    models, runtimeRoot: '/app', dataDir: '/data', receiptPath: join(p, 'operator-receipt.json'), moduleHashes,
    tenantSchemaSha256: hash(JSON.stringify(ro.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all())),
    exclusiveWindow: tenantId + '-root-approved', exclusiveUntil: Date.now() + 3600000, noOtherTargetRequests: true,
    maxToolCalls: 40, maxExposureUsd: input.maxExposureUsd, reservedTurnExposureUsd: 0.25,
    costBoundRationale: `Parent-authorized single ${input.caseKey}, models ${Object.entries(models).map(([k, v]) => `${k}=${v}`).join(' ')}, above isolated observed cost. Reservation/stop gate only; not hard provider cap; no second pair or rerun.`,
  };
  save('manifest-prebootstrap.json', m);
  step = 'configure';
  const {readEvaluationKey} = await import(pathToFileURL(join(p, 'read-evaluation-key.mjs')));
  let providerKey = readEvaluationKey({tenantId: 'github-63050995', masterKey: process.env.CHASSIS_VAULT_MASTER_KEY});
  secrets.push(providerKey);
  await api('/api/settings', 'PUT', {provider: 'openrouter', openrouter_api_key: providerKey, github_token: input.githubToken, vault_repo: input.repo.full_name, vault_branch: 'main', ...models});
  providerKey = undefined;
  step = 'bootstrap';
  const vault = await api('/api/vault');
  save('vault-bootstrap.json', vault);
  if (vault.cloneError || vault.repo !== input.repo.full_name || !vault.cloned) throw Error('bootstrap_failed');
  const lint = await api('/api/vault/lint');
  save('vault-lint.json', lint);
  if (!lint.ok) throw Error('lint_failed');
  const work = join('/data', tenantId, 'vault');
  m.seedCommit = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  m.observedRelease.checkedAt = Date.now();
  save('manifest.json', m);
  save('bootstrap-tree.json', {seedCommit: m.seedCommit, files: execFileSync('git', ['-C', work, 'ls-files'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim().split('\n')});
  step = 'check_only';
  io = await createOperator(m, {tenantToken, githubToken: input.githubToken});
  const checked = await runProductionCase(m, f, rub, io);
  save('check-only.json', checked);
  io.dispose(); io = null;
  if (!checked.ready) throw Error('check_not_ready');
  step = 'dispatch';
  mkdirSync(m.receiptPath + '.lock', {mode: 0o700});
  io = await createOperator(m, {tenantToken, githubToken: input.githubToken}, {dispatch: true});
  const result = await runProductionCase(m, f, rub, io, {dispatch: true});
  completed = result.phase === 'complete';
  try { save('usage.json', readTenantUsage(tenantId)); } catch { save('usage.json', {available: false, error: 'usage_read_failed'}); }
  save('execution-summary.json', {phase: result.phase, error: result.error ?? null, cleanupError: result.cleanupError ?? null, outcomes: result.run.outcomes.map((x) => ({key: x.key, status: x.status, gates: x.gates})), cost: result.cost});
  if (completed) rmdirSync(m.receiptPath + '.lock');
  console.log(JSON.stringify({phase: result.phase, caseStatus: result.run.outcomes.find((x) => x.key === input.caseKey)?.status, tenantId, repo: input.repo.full_name, models, cost: result.cost}));
} catch (e) {
  save('execution-stop.json', {step, errorCode: /^[a-z0-9_]+$/.test(e.message ?? '') ? e.message : 'operator_failed', uncertain, tenantCreated: Boolean(tenantToken), repo: input.repo.full_name});
  if (tenantToken && m && !uncertain && !existsSync(m.receiptPath + '.lock')) {
    try {
      io?.dispose();
      io = await createOperator(m, {tenantToken, githubToken: input.githubToken}, {dispatch: true, cleanupOnly: true});
      const cleanup = await runProductionCase(m, f, rub, io, {dispatch: true, cleanupOnly: true});
      save('setup-cleanup.json', {phase: cleanup.phase, cleanupError: cleanup.cleanupError ?? null});
    } catch { save('setup-cleanup.json', {phase: 'cleanup_pending'}); }
  }
  console.log(JSON.stringify({status: 'stopped', step, uncertain, tenantCreated: Boolean(tenantToken)}));
  process.exitCode = 1;
} finally {
  io?.dispose();
  save('protected-targets-after.json', ownerSnapshot());
  ro.close();
  tenantToken = undefined;
  input.githubToken = undefined;
}
process.exit(process.exitCode ?? 0);
