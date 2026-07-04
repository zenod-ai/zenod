// Local copy of the tool-name normalizer (lowercase, strip non-alphanumerics). Kept here
// rather than imported from taskingPolicy.ts to avoid an import cycle — this module is a
// leaf the reconciler depends on.
function normalize(tool: string): string {
  return tool.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * FP4 (#548) — the single source of truth for whether a tool the LLM can call is a
 * READ (no side effect: searches, status lookups, transcript/ledger reads, draft
 * composition) or a MUTATE (a real side effect: create/edit/close/label an issue, queue
 * or run an execution, send outbound, raise an event, write memory or the vault).
 *
 * reconcileTaskingReply consumes this to decide whether a correction banner is permitted
 * on a turn: a composer correction may only render when a mutation was actually attempted
 * (or nothing ran at all — a pure prose hallucination). Classifying by a DECLARED registry
 * instead of a name-regex allowlist is the structural fix for the C-23 banner family: the
 * old `isReadOnlyTaskingTool` regex silently failed open on any read tool it didn't match
 * (e.g. `archus_list_github_issues` → spurious banner). Here every tool is declared, an
 * unknown name fails SAFE to `mutate` (never hide a real fabrication — C-15), and a
 * coverage test asserts no known tool is missing, so the fail-safe never fires in practice.
 */
export type ToolKind = "read" | "mutate";

// READ tools — no side effect. Normalized (lowercase, non-alphanumerics stripped).
const READ_TOOLS: readonly string[] = [
  // vault / conversation reads (engine readTools + aisdk read tool set)
  "searchvault",
  "readnote",
  "listpages",
  "searchchats",
  // Zenod memory peer reads
  "zenoddigestmessage",
  "askzenod",
  "searchmemory",
  "getmemory",
  "getrecentconversationtranscript",
  "readllmtimeline",
  // Archus backlog reads
  "archusreadexactgithubissue",
  "archussearchgithubissues",
  "archuslistgithubissues",
  "askarchus",
  // Epaminon execution reads
  "epaminonreadissueexecutionstatus",
  "executionstatus",
  "epaminonreadissueexecution",
  // Console tasking reads
  "querybacklog",
  "servicebacklog",
  "listdrivefiles",
  "proposevaulttask",
  "digestbacklog",
  // Outbound reads + draft-only compose (composes a draft, never sends)
  "askoutbound",
  "readxpost",
  "readxmentions",
  "searchx",
  "searchreddit",
  "readsubreddit",
  "readredditreplies",
  // Phylax delegate read
  "askphylax",
];

// MUTATE tools — a real, checkable side effect. Kept explicit (not just "everything not
// read") so the coverage test can assert both halves and drift is caught in CI.
const MUTATE_TOOLS: readonly string[] = [
  // issue writes (task + Archus peer)
  "createissue",
  "openissue",
  "editissue",
  "closeissue",
  "labelissue",
  "archusrequestbacklogaction",
  // execution dispatch / approvals
  "queueexecution",
  "approveexecution",
  "approvequeue",
  "approvemerge",
  "archusrunissue",
  "epaminonrunexistingissue",
  "consolecreateissuethenrun",
  "consolecreateissues",
  "consolerunephemeraltask",
  // typed backlog gateway writes
  "backlogcreate",
  "backlogedit",
  "backlogclose",
  "backlogcomment",
  // memory / vault writes
  "addmemory",
  "storememory",
  "capturenote",
  "executevaulttask",
  "ingestdrivefile",
  // outbound sends
  "posttweet",
  "postreddit",
  "sendemail",
  // notifier side effect
  "raiseevent",
  "delivertoprincipal",
];

const KIND_BY_NAME: ReadonlyMap<string, ToolKind> = new Map<string, ToolKind>([
  ...READ_TOOLS.map((n) => [n, "read"] as const),
  ...MUTATE_TOOLS.map((n) => [n, "mutate"] as const),
]);

/**
 * The declared kind for a tool. Unknown names fail SAFE to `mutate`: a correction banner
 * is then permitted, so an unclassified tool can never HIDE a real fabrication (C-15). The
 * coverage test keeps this from ever mattering for a real tool.
 */
export function toolKind(tool: string): ToolKind {
  return KIND_BY_NAME.get(normalize(tool)) ?? "mutate";
}

/** True when the tool has an explicit declaration (used by the coverage assertion). */
export function isKnownTool(tool: string): boolean {
  return KIND_BY_NAME.has(normalize(tool));
}

/** Exported for the coverage test — the exact declared name sets. */
export const DECLARED_READ_TOOLS = READ_TOOLS;
export const DECLARED_MUTATE_TOOLS = MUTATE_TOOLS;
