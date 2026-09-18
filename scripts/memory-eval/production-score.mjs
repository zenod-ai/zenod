// Scoring for the production memory batch. Decision scoring answers "did the
// classifier choose the expected page/disposition"; outcome scoring answers "did
// the engine actually write the page and file the topics". The create-page
// defects of 2026-09-18 sat entirely after the decision, so a decision-only
// check passed while nothing was ever filed: cases that declare expectOutcome
// must therefore prove the written page and the filed topics.
const CANNED_CLARIFICATION = "Branch discovery is incomplete";

export function scoreCase(entry, receipt) {
  const topics = Array.isArray(receipt?.topics) ? receipt.topics : [];
  const gotPages = new Set();
  const gotDisp = new Set();
  const canned = [];
  let filedTopics = 0;
  for (const topic of topics) {
    if (topic.disposition) gotDisp.add(topic.disposition);
    for (const page of (topic.filedPages ?? topic.pages ?? [])) gotPages.add(String(page));
    if (topic.status === "filed" || (topic.filedPages ?? []).length) filedTopics++;
    const reason = String(topic.reason ?? "");
    const refusedNewPage = topic.status !== "filed"
      && (reason.includes(CANNED_CLARIFICATION) || (Number(topic.confidence) <= 0.69 && (topic.filedPages ?? []).length === 0 && (topic.pages ?? []).length === 0));
    if (refusedNewPage) canned.push(reason || `${topic.disposition}@${topic.confidence}`);
  }
  const wantPages = new Set(entry.expectPage ? String(entry.expectPage).split("|") : []);
  const pageOk = wantPages.size === 0 ? gotPages.size === 0 : [...gotPages].some((page) => wantPages.has(page));
  const dispOk = !entry.expectDisposition || gotDisp.has(entry.expectDisposition);
  const outcome = entry.expectOutcome ?? null;
  const touched = new Set([...(receipt?.pagesTouched ?? []).map(String), ...gotPages]);
  const outcomeChecks = outcome ? {
    pageWritten: !outcome.page || touched.has(outcome.page),
    filedTopics,
    minFiledTopics: outcome.minFiledTopics ?? 1,
    filedEnough: filedTopics >= (outcome.minFiledTopics ?? 1),
    noCannedClarification: canned.length === 0,
  } : null;
  const outcomeOk = !outcome || (outcomeChecks.pageWritten && outcomeChecks.filedEnough && outcomeChecks.noCannedClarification);
  return { pageOk, dispOk, outcomeOk, outcomeChecks, correct: pageOk && dispOk && outcomeOk,
    gotPages: [...gotPages], gotDisp: [...gotDisp], filedTopics, canned };
}
