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

// M-3 — text signal that the request is asking to CREATE/FILE/OPEN a GitHub
// issue/ticket in a code repo, not just do arbitrary one-off work. A request
// carrying this intent must never be dispatched as a plain issue-less ephemeral
// execution (the ephemeral worker prompt's own default is NOT to create an
// issue) — it needs the forced gh-issue-create objective below.
const ISSUE_CREATE_INTENT_RE = /\b(create|open|file|log|raise|add)\b[\s\S]{0,60}\b(issue|ticket|bug)\b/i;

export function isIssueCreateIntent(text: string): boolean {
  return ISSUE_CREATE_INTENT_RE.test(String(text || ""));
}

// M-3 — a separate ask to post a comment (e.g. "create issue banana9 + comment
// banana8"), which the forced objective below folds in as a second worker step.
const COMMENT_INTENT_RE = /\bcomment\b/i;

export function wantsIssueComment(text: string): boolean {
  return COMMENT_INTENT_RE.test(String(text || ""));
}

const ISSUE_CREATE_LEAD_RE = /\b(?:create|open|file|log|raise|add)\s+(?:an?\s+)?(?:issue|ticket|bug)\b\s*[:\-]?\s*/i;
const TRAILING_REPO_CLAUSE_RE = /\s+(?:in|on|to|for)\s+(?:the\s+)?[A-Za-z0-9_.\-/]+(?:\s+repo(?:sitory)?)?\s*$/i;
const TRAILING_COMMENT_CLAUSE_RE = /\s*(?:\+|,|;|\band\b)\s*(?:also\s+)?comment\b.*$/i;

/**
 * M-3 — pull the actual issue subject out of a natural-language create request, so
 * the created issue's title is "banana9", not the whole verbatim instruction
 * "create issue banana9 in the Zenod repo". Strips the leading create/open/file
 * verb phrase, then a trailing "in/on <repo>" clause and/or a "+ comment ..."
 * clause. Falls back to the original text untouched when nothing matches, so a
 * phrasing this doesn't recognize still gets a title (via oneOffIssueTitle) rather
 * than an empty one.
 */
export function extractIssueCreateSubject(text: string): string {
  let subject = String(text || "").trim();
  const lead = ISSUE_CREATE_LEAD_RE.exec(subject);
  if (lead) subject = subject.slice(lead.index + lead[0].length);
  subject = subject.replace(TRAILING_COMMENT_CLAUSE_RE, "").replace(TRAILING_REPO_CLAUSE_RE, "").trim();
  return subject || String(text || "").trim();
}

const COMMENT_SUBJECT_RE = /\bcomment\b\s*[:\-]?\s*/i;

/** M-3 — pull the comment text out of "... + comment banana8"; undefined when nothing follows "comment". */
export function extractCommentSubject(text: string): string | undefined {
  const source = String(text || "");
  const match = COMMENT_SUBJECT_RE.exec(source);
  if (!match) return undefined;
  const after = source.slice(match.index + match[0].length).trim();
  return after || undefined;
}

export interface ForeignIssueCreateObjective {
  objective: string;
  artifactPolicy: string;
}

/**
 * M-3 — the forced objective/artifactPolicy text that makes an Epaminon worker
 * actually run `gh issue create -R <repo>` first (never skip it) and report the
 * created issue's URL as the deliverable, instead of the generic ephemeral
 * prompt's default of NOT creating a GitHub issue unless explicitly told to
 * (backlog-monitor.mjs's ephemeralPrompt). Shared by createIssueRunJourney.ts's
 * dispatchForeignRepoWorker (the create-then-run journey) and the raw
 * epaminon.run_ephemeral_task chokepoint (app.ts) so an issue-create request is
 * forced onto this flow regardless of which tool a caller reached it through.
 */
// Marker text unique to an artifactPolicy already built by buildForeignIssueCreateObjective
// — lets a caller detect "this objective was already forced onto the issue-create worker
// flow" and avoid re-detecting/re-wrapping an already-forced request (app.ts's chokepoint).
export const FORCED_ISSUE_CREATE_MARKER = "This IS an issue-creation task";

export function isAlreadyForcedIssueCreateObjective(artifactPolicy: string | undefined): boolean {
  return Boolean(artifactPolicy && artifactPolicy.includes(FORCED_ISSUE_CREATE_MARKER));
}

export function buildForeignIssueCreateObjective(params: {
  repo: string;
  title: string;
  body: string;
  postComment?: string;
}): ForeignIssueCreateObjective {
  const objective = (
    `Create a GitHub issue in ${params.repo} via \`gh issue create -R ${params.repo}\` under the runner's ` +
    `existing gh auth — title "${params.title}", body below — THEN execute exactly that issue.\n\n` +
    `Issue body:\n${params.body}` +
    (params.postComment
      ? `\n\nAlso post this comment on the created issue via \`gh issue comment -R ${params.repo} <issue-number>\`: ${params.postComment}`
      : "")
  ).trim();
  const artifactPolicy =
    `${FORCED_ISSUE_CREATE_MARKER}: run \`gh issue create -R ${params.repo}\` first (never skip it), ` +
    `then work the created issue${params.postComment ? " and post the requested comment on it" : ""}. ` +
    `Report the created issue's URL (https://github.com/${params.repo}/issues/N) ` +
    `as the deliverable/evidence, in addition to any commit/PR from the work itself.`;
  return { objective, artifactPolicy };
}

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
