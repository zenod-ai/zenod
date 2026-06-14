export const OWNER_AGENT = "owner:agent";
export const STATUS_PROPOSED = "status:proposed";
export const STATUS_QUEUED = "status:queued";
export const STATUS_NEEDS_REVIEW = "status:needs-review";
export const STATUS_APPROVED_MERGE = "status:approved-merge";
export const STATUS_MERGED = "status:merged";

// Privileged statuses an agent can never set through the generic create/label
// tools — each has a dedicated, human-gated approval tool (approve_queue,
// approve_merge). Attempts via create/label are rewritten to proposed.
const GATED_STATUSES = new Set([STATUS_QUEUED, STATUS_APPROVED_MERGE]);

export function normalizeCreateIssueLabels(labels?: string[]): string[] {
  return ensureProposedStatus(normalizeAgentMutableLabels(labels ?? []));
}

export function normalizeLabelIssueLabels(labels: string[]): string[] {
  return normalizeAgentMutableLabels(labels);
}

function normalizeAgentMutableLabels(labels: string[]): string[] {
  const normalized = labels.map((label) => (GATED_STATUSES.has(label) ? STATUS_PROPOSED : label));
  return [...new Set(normalized)];
}

function ensureProposedStatus(labels: string[]): string[] {
  return labels.includes(STATUS_PROPOSED) ? labels : [...labels, STATUS_PROPOSED];
}
