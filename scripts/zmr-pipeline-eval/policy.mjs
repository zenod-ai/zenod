import { createHash } from 'node:crypto';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const HELDOUT_SHA256 = '9f4730688c2d94212d6d9daeecdf9285eedc4d5f924c25721e820438d37aeb21';
export function validateFixture(bytes, expectedHash = HELDOUT_SHA256) {
  if (sha256(bytes) !== expectedHash) throw new Error('Frozen fixture checksum mismatch');
  const fixture = JSON.parse(bytes);
  if (!fixture.id || typeof fixture.transcript !== 'string' || !Array.isArray(fixture.ground_truth)) throw new Error('Invalid fixture');
  for (const path of Object.keys(fixture.seed_pages)) {
    if (!/^(Projects|Areas|Notes|Resources)\/.+\.md$/.test(path) || path.includes('..') || path.includes('\\')) throw new Error('Unsafe fixture page path');
  }
  if((fixture.forbidden_updates??[]).some(path=>!Object.hasOwn(fixture.seed_pages,path)) || (fixture.preserve_exact??[]).some(text=>!Object.values(fixture.seed_pages).some(page=>page.includes(text))))throw new Error('Invalid frozen preservation controls');
  // Authoring offsets are codepoints. Runtime source spans are UTF-16 units.
  const points = Array.from(fixture.transcript);
  for (const idea of fixture.ground_truth) {
    if (points.slice(idea.start, idea.end).join('') !== idea.text) throw new Error('Ground-truth source offset mismatch');
  }
  return fixture;
}
export function sourceInput(fixture) {
  // Never spread a fixture: expected operations and destinations cannot enter model input.
  return {content: fixture.transcript, source: 'mcp', contentType: 'voice_note', verbatim: true,
    sourceId: 'isolated-eval:' + fixture.id, capturedAt: '2026-09-13T12:00:00.000Z'};
}
export function utf16Range(fixture, idea) {
  const points = Array.from(fixture.transcript);
  return {start: points.slice(0, idea.start).join('').length, end: points.slice(0, idea.end).join('').length};
}
export function parseWireUsage(text) {
  const frames = text.trim().startsWith('data:')
    ? text.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').flatMap(line => {try {return [JSON.parse(line.slice(6))];} catch {return [];}})
    : (() => {try {return [JSON.parse(text)];} catch {return [];}})();
  const last = [...frames].reverse().find(frame => frame.usage);
  return {model: last?.model ?? frames.find(frame => frame.model)?.model ?? null,
    provider: last?.provider ?? frames.find(frame => frame.provider)?.provider ?? null,
    usage: last?.usage ?? null};
}
export function budgetLedger({budgetUsd, maxRequests, prices}) {
  if (!(budgetUsd > 0 && budgetUsd <= 1) || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 80) throw new Error('Invalid evaluation caps (maximum $1 and 80 requests)');
  let exposure = 0;
  const rows = [];
  return {rows, get exposureUsd() {return exposure;}, reserve(body) {
    if (rows.length >= maxRequests) throw new Error('evaluation_request_budget_exhausted');
    const price = prices[body.model];
    if (!price || ![price.inputUsdPerMillion, price.outputUsdPerMillion, price.maxOutputTokens].every(Number.isFinite)
        || price.inputUsdPerMillion < 0 || price.outputUsdPerMillion < 0 || price.maxOutputTokens < 1) throw new Error('Missing reviewed model price/output limit');
    // Conservative byte upper bound for uncached input; no cache savings assumed.
    const limits = ['max_tokens', 'max_completion_tokens'].filter(key => Object.hasOwn(body, key)).map(key => body[key]);
    if (!limits.length || limits.some(value => !Number.isInteger(value) || value <= 0)
        || (limits.length === 2 && limits[0] !== limits[1])) throw new Error('Explicit unambiguous wire output limit required');
    const output = limits[0];
    if (!Number.isInteger(output) || output <= 0 || output > price.maxOutputTokens) throw new Error('Unknown model output exposure');
    const reservation = (Buffer.byteLength(JSON.stringify(body)) * price.inputUsdPerMillion + output * price.outputUsdPerMillion) / 1e6;
    if (exposure + reservation > budgetUsd) throw new Error('evaluation_cost_budget_exhausted');
    const row = {request: rows.length + 1, model: body.model, reservedUsd: reservation, actualCostUsd: null, status: 'reserved'};
    rows.push(row); exposure += reservation;
    return row;
  }, complete(row, wire, status) {
    row.status = status; row.wire = wire;
    const cost = wire?.usage?.cost;
    if (Number.isFinite(cost) && cost >= 0) {row.actualCostUsd = cost; exposure += cost - row.reservedUsd;}
    // Missing provider cost retains full reservation; never count unknown usage as free.
  }};
}
export function coverageRows(fixture, result, contentOffset = 0) {
  return fixture.ground_truth.map(idea => {
    const range = utf16Range(fixture, idea);
    const matches = (result?.topics ?? []).filter(topic => topic.sourceSpans?.some(span => span.start < range.end + contentOffset && span.end > range.start + contentOffset));
    return {id: idea.id, expectedOperation: idea.operation, expectedPage: idea.page, sourceRange: range,
      structurallyAssigned: matches.length > 0, matchedTopics: matches, semanticVerdict: 'REVIEW_REQUIRED'};
  });
}

/** Isolate real ASR from test hooks and keep model credentials out of child env. */
export function prepareAsrEnvironment(env) {
  if (env.NODE_ENV === 'test' || Object.hasOwn(env, 'VITEST')
      || Object.keys(env).some(key => /^ZENOD_(?:WHISPER_FAKE|TRANSCRIPTION_FAKE)/.test(key))) {
    throw new Error('Actual ASR rejects test/provider simulation hooks');
  }
  const evaluationKey = env.ZMR_EVAL_OPENROUTER_KEY;
  if (typeof evaluationKey !== 'string' || !evaluationKey) throw new Error('Protected evaluation key required');
  for (const key of ['ZMR_EVAL_OPENROUTER_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY']) delete env[key];
  return evaluationKey;
}

/** Never begin replay or recall while enrichment is unfinished or failed. */
export function requireCompletedEnrichment(job) {
  if (job?.status !== 'done' || !job.input || !job.result) throw new Error('ASR enrichment did not complete; replay/recall blocked');
}

/** Run-local latch: a provider quota denial cannot be repaired by SDK/job retries. */
export function terminalProviderGuard() {
  let terminal = null;
  return {
    get terminal() { return terminal; },
    assertActive() {
      if (terminal) {
        const error = new Error('evaluation_provider_quota_exhausted');
        error.name = 'EvaluationProviderQuotaError';
        error.isRetryable = false;
        throw error;
      }
    },
    observe(status, text, {stage, request}) {
      if (terminal || status !== 403) return;
      let message;
      try { message = JSON.parse(text)?.error?.message; } catch { return; }
      if (typeof message !== 'string' || !/(?:key limit exceeded|quota (?:exceeded|exhausted)|monthly limit exceeded)/i.test(message)) return;
      // Do not carry provider messages/URLs/key identifiers into public summaries.
      terminal = {status:'INCOMPLETE_PROVIDER_QUOTA', code:'evaluation_provider_quota_exhausted',
        httpStatus:403, stage, request, at:new Date().toISOString()};
    },
  };
}

/** Actual HTTP boundary shared by both drivers; catches SDK and durable-job retries. */
export function evaluationFetch({ledger, quota, fetchImpl, stage = () => 'unknown',
  onRequest = async () => {}, onResponse = async () => {}, onFinish = async () => {},
  onBudgetBlock = () => {}, onDenied = () => {}}) {
  return async (input, init) => {
    quota.assertActive();
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin !== 'https://openrouter.ai' || url.pathname !== '/api/v1/chat/completions' || request.method !== 'POST') {
      onDenied(); throw new Error('evaluation_unapproved_network_destination');
    }
    const body = await request.clone().json();
    quota.assertActive();
    let row;
    try { row = ledger.reserve(body); } catch (error) { onBudgetBlock({stage:stage(),reason:error.message,at:new Date().toISOString()}); throw error; }
    row.stage=stage(); row.startedAt=new Date().toISOString(); row.inputSha256=sha256(JSON.stringify(body));
    const start=performance.now(); let settled=false;
    try {
      await onRequest(row, body);
      quota.assertActive(); // An earlier in-flight request may have latched while saving.
      const response=await fetchImpl(new Request(request,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(120000)])}));
      const text=await response.clone().text();
      quota.observe(response.status,text,row);
      ledger.complete(row,parseWireUsage(text),response.ok?'succeeded':'failed'); settled=true; row.httpStatus=response.status;
      await onResponse(row,text);
      if (quota.terminal) {
        // Preserve the exact response privately, but keep SDK/job errors safe too.
        return new Response(JSON.stringify({error:{code:403,message:'evaluation_provider_quota_exhausted'}}),
          {status:403,headers:{'content-type':'application/json'}});
      }
      return response;
    } catch(error) {
      if (!settled) ledger.complete(row,null,'failed');
      row.errorClass=error.name; throw error;
    } finally { row.latencyMs=performance.now()-start; await onFinish(row); }
  };
}

export function evaluationCostSummary(ledger) {
  return {providerReportedCostUsd:ledger.rows.reduce((sum,row)=>sum+(row.actualCostUsd??0),0),
    retainedUnknownCostReservationsUsd:ledger.rows.reduce((sum,row)=>sum+(row.actualCostUsd===null?row.reservedUsd:0),0),
    exposureUsd:ledger.exposureUsd};
}
export function evaluationCompletion({quota, recalls, plannedRecalls, budgetBlocks = [], invariantFailed = false, offline = false}) {
  const recallCoverage={planned:plannedRecalls,attempted:recalls.length,completed:recalls.filter(row=>row.answer).length,
    failed:recalls.filter(row=>!row.answer).length,notStarted:Math.max(0,plannedRecalls-recalls.length)};
  const status=quota.terminal?'INCOMPLETE_PROVIDER_QUOTA':invariantFailed?'INVARIANT_FAILURE':budgetBlocks.length?'INCOMPLETE_BUDGET'
    :recallCoverage.completed!==plannedRecalls?'INCOMPLETE_CALL_FAILURE':offline?'OFFLINE_PLUMBING_ONLY':'AWAITING_INDEPENDENT_SEMANTIC_REVIEW';
  return {status,recallCoverage,...(quota.terminal?{providerQuota:quota.terminal}:{})};
}

/** Preserve attempted trials only. A terminal provider denial leaves the rest unmeasured. */
export async function runEvaluationRecalls({questions, quota, recalls, runTrial}) {
  recallTrials: for (const question of questions) for (let trial=1;trial<=3;trial++) {
    if (quota.terminal) break recallTrials;
    try { recalls.push({id:question.id,trial,question:question.question,...await runTrial(question,trial),semanticVerdict:'REVIEW_REQUIRED'}); }
    catch(error) { recalls.push({id:question.id,trial,errorClass:error.name,semanticVerdict:'FAILED_CALL'}); }
  }
}
