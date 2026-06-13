export const STATUS_PROPOSED = "status:proposed";
export const STATUS_QUEUED = "status:queued";

export function normalizeCreateIssueLabels(labels?: string[]): string[] {
  return ensureProposedStatus(normalizeAgentMutableLabels(labels ?? []));
}

export function normalizeLabelIssueLabels(labels: string[]): string[] {
  return normalizeAgentMutableLabels(labels);
}

function normalizeAgentMutableLabels(labels: string[]): string[] {
  const normalized = labels.map((label) => (label === STATUS_QUEUED ? STATUS_PROPOSED : label));
  return [...new Set(normalized)];
}

function ensureProposedStatus(labels: string[]): string[] {
  return labels.includes(STATUS_PROPOSED) ? labels : [...labels, STATUS_PROPOSED];
}
