// Expected-behavior checklist for the M2 production eval.
//
// This is a review aid for manual scoring, not an auto-grader: it lists the
// literals and conditions a reviewer checks against the literal answer and
// cited evidence. It is intentionally separate from the frozen fixture so the
// ground truth stays stable while prompts and models change.
import {readFileSync} from 'node:fs';

const SOURCE = new URL('./expectations.json', import.meta.url);
const CASE_IDS = Array.from({length: 12}, (_, i) => `B${String(i + 1).padStart(2, '0')}`);

export function loadExpectations(url = SOURCE) {
  return parseExpectations(JSON.parse(readFileSync(url, 'utf8')));
}

export function parseExpectations(value) {
  if (!value || typeof value !== 'object') throw new Error('expectations: not an object');
  if (typeof value.version !== 'string' || !value.version) throw new Error('expectations: missing version');
  if (!value.cases || typeof value.cases !== 'object') throw new Error('expectations: missing cases');
  for (const id of CASE_IDS) {
    const entry = value.cases[id];
    if (!entry || typeof entry !== 'object') throw new Error(`expectations: missing case ${id}`);
    for (const key of ['requiredFacts', 'forbidden', 'conditions']) {
      if (!Array.isArray(entry[key]) || entry[key].some((x) => typeof x !== 'string' || !x.trim())) {
        throw new Error(`expectations: ${id}.${key} must be a list of non-empty strings`);
      }
    }
    if (typeof entry.requireCitation !== 'boolean') throw new Error(`expectations: ${id}.requireCitation must be boolean`);
  }
  return value;
}

/** Case-level literal/condition checks against a literal answer string. */
export function literalChecks(expectations, caseId, answerText = '') {
  const entry = expectations.cases[caseId];
  if (!entry) throw new Error(`expectations: unknown case ${caseId}`);
  const has = (needle) => answerText.toLowerCase().includes(needle.toLowerCase());
  return {
    caseId,
    name: entry.name,
    requiredFacts: entry.requiredFacts.map((fact) => ({fact, present: has(fact)})),
    forbidden: entry.forbidden.map((fact) => ({fact, present: has(fact)})),
    conditions: entry.conditions,
    requireCitation: entry.requireCitation,
  };
}
