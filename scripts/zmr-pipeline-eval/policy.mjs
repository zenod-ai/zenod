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
