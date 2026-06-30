/**
 * One-off (formerly "ephemeral") execution helpers (#stab).
 *
 * Principle: there are NO issue-less executions. A one-off task still gets a real
 * execution ticket — a GitHub issue holding the job description — that Archus mints
 * and Epaminon runs against, so it is durable, traceable, and records its outcome on
 * the issue. "Ephemeral" only ever meant "no separate planning/backlog ticket"; it
 * never meant "no ticket". These builders turn a free-form one-off request into a
 * runnable issue body that passes the create-and-run runnable-ticket validation.
 */

export function oneOffIssueTitle(objective: string): string {
  const first = (String(objective || "").split("\n")[0] ?? "").trim();
  if (!first) return "One-off execution";
  return first.length > 80 ? `${first.slice(0, 79)}…` : first;
}

export interface OneOffIssueInput {
  objective: string;
  instructions?: string;
  repo?: string;
  path?: string;
  deployNote?: string;
  artifactPolicy?: string;
}

/**
 * Build a runnable issue body for a one-off. Includes the four sections the
 * create-and-run validator requires (objective, scope, acceptance criteria, source
 * context) so the ticket is never bounced as needs-clarification, and bakes in the
 * evidence/deploy-honesty done-condition (real commit/PR URL; confirm or flag deploy).
 */
export function buildOneOffIssueBody(input: OneOffIssueInput): string {
  const scope = input.instructions?.trim() || "Complete the objective above; make no unrelated changes.";
  const done =
    "The objective is achieved. For code work: the change is committed and pushed, with the real commit or PR URL reported as evidence (a bare or invented SHA is not acceptable); if it must go live, redeploy is confirmed or explicitly reported as unconfirmed. For research/ops: the result is reported on this ticket.";
  const ctx = [
    input.repo ? `repo: ${input.repo}` : "",
    input.path ? `path: ${input.path}` : "",
    input.deployNote ? `deploy: ${input.deployNote}` : "",
    input.artifactPolicy ? `artifact policy: ${input.artifactPolicy}` : "",
    "One-off execution: no separate backlog/planning ticket — this execution ticket is the record.",
  ]
    .filter(Boolean)
    .join("; ");
  return [
    `Objective: ${input.objective.trim()}`,
    "",
    `Scope: ${scope}`,
    "",
    `Acceptance criteria: ${done}`,
    "",
    `Source context: ${ctx}`,
  ].join("\n");
}
