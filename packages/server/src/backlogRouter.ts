/**
 * E-4 (AlfaBlok/obsidian-brain#231) — "Routing without improvisation, round 2".
 *
 * A DETERMINISTIC router that sits in FRONT of the two-door backlog write tools
 * (backlog_create/edit/close/comment/list, hard-wired to the life backlog) and
 * the code-execution lane (console_create_issue_then_run / console_run_ephemeral_task,
 * repo-scoped work run by Epaminon). There is NO LLM in the repo-decision path.
 *
 * It fixes three misroutes seen in round 1:
 *   D2 — a life-level epic went to the CODE lane; it must default to the life backlog.
 *   D4 — Archus offered to write a NON-backlog repo (nectary) directly; that must be
 *        intercepted with a redirect + Epaminon handoff (per the standing rule:
 *        Archus mines exactly ONE backlog, AlfaBlok/obsidian-brain, and NEVER writes
 *        any other repo — all other-repo writes are Epaminon dispatching a worker
 *        that uses the runner's `gh` auth on the VPS). Same fix as S0-T5 (#224).
 *   D1 — asked "which repo?" when the target was obvious; a keyword→repo inference
 *        table is consulted BEFORE asking, and only asks below a confidence floor.
 *
 * The standing rule (settled 2026-07-02): M1 is DEAD, there is no GitHub App to
 * install, and Archus writes ONLY the life backlog. This module encodes that rule as
 * code so a stale label or doc can never re-route a write to another repo.
 */

import { readFileSync } from "node:fs";

/** The single backlog Archus mines and writes. Hard-wired; never a parameter. */
export const LIFE_BACKLOG_REPO = "AlfaBlok/obsidian-brain";

/**
 * A deterministic keyword→repo inference entry (E4-T3). Data-driven and easy to
 * extend: add a row here (or override via ZENOD_REPO_INFERENCE_FILE) and the router
 * resolves the target repo without ever asking "which repo?" or guessing with an LLM.
 */
export interface RepoInferenceEntry {
  /** Canonical GitHub repo as owner/repo (the code repo a worker would target). */
  repo: string;
  /** Keywords/phrases that point at this repo, lowercased for matching. */
  keywords: string[];
  /** One line describing the repo, surfaced to the agent for confident routing. */
  description?: string;
}

/**
 * The built-in inference table. WhatsApp gateway / voice / vault → zenod-ai/zenod;
 * waitlist / claims → nectary. Extend freely; keep it data, not code branches.
 */
export const DEFAULT_REPO_INFERENCE: RepoInferenceEntry[] = [
  {
    repo: "zenod-ai/zenod",
    keywords: [
      "whatsapp gateway",
      "whatsapp",
      "telegram gateway",
      "voice note",
      "voice transcription",
      "voice",
      "vault",
      "librarian",
      "compactor",
      "miner",
      "engine",
      "the zenod app",
      "zenod codebase",
      "console",
    ],
    description: "Zenod itself — the memory agent: WhatsApp/Telegram gateways, voice pipeline, vault engine, Console.",
  },
  {
    repo: "AlfaBlok/nectary",
    keywords: ["nectary", "waitlist", "claims", "claim flow"],
    description: "Nectary — the finances/waitlist product (waitlist signup, claims).",
  },
  {
    repo: "AlfaBlok/idea_scraper",
    keywords: ["dioptra", "optra", "idea scraper", "idealista scraper", "the telegram bot"],
    description: "DIOPTRA/OPTRA — the idea/idealista-scraper Telegram bot.",
  },
];

function normalize(s: string): string {
  return String(s || "").toLowerCase().replace(/[_./]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Load the inference table: a valid ZENOD_REPO_INFERENCE_FILE JSON array wins. */
export function loadRepoInference(env: NodeJS.ProcessEnv = process.env): RepoInferenceEntry[] {
  const file = env.ZENOD_REPO_INFERENCE_FILE;
  if (file) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (p): p is RepoInferenceEntry => p && typeof p.repo === "string" && Array.isArray(p.keywords),
        );
      }
    } catch {
      // fall through to built-ins; a broken override must not blank the table.
    }
  }
  return DEFAULT_REPO_INFERENCE;
}

/**
 * PURE: infer the target CODE repo from free text. Matches the longest keyword that
 * appears as a whole phrase. Returns null when nothing matches confidently — the
 * caller should then ask, not guess. Never returns the life backlog (that is a
 * separate decision handled by routeBacklogRequest).
 */
export function inferRepo(table: RepoInferenceEntry[], text: string): RepoInferenceEntry | null {
  const q = normalize(text);
  if (!q) return null;
  // Exact owner/repo or bare repo name.
  for (const entry of table) {
    if (q === normalize(entry.repo) || q === normalize(entry.repo.split("/").pop() || "")) return entry;
  }
  let best: { entry: RepoInferenceEntry; len: number } | null = null;
  for (const entry of table) {
    if (q.split(" ").includes(normalize(entry.repo.split("/").pop() || ""))) {
      const len = (entry.repo.split("/").pop() || "").length;
      if (!best || len > best.len) best = { entry, len };
    }
    for (const kw of entry.keywords) {
      const kn = normalize(kw);
      if (!kn) continue;
      const re = new RegExp(`(^|\\s)${kn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
      if (re.test(q) && (!best || kn.length > best.len)) best = { entry, len: kn.length };
    }
  }
  return best?.entry ?? null;
}

export type BacklogRoute =
  /** Outcome-level / no-code-repo item → write the life backlog (backlog_create etc.). */
  | { kind: "life_backlog"; reason: string }
  /**
   * A write aimed at a NON-backlog code repo through Archus. Archus must NOT write it;
   * intercept with the standard redirect and hand off to Epaminon on user "yes".
   */
  | { kind: "worker_dispatch"; repo: string; reason: string; redirect: string }
  /**
   * The target code repo is obvious from the inference table (E4-T3) but confidence
   * about WHETHER to run vs file is below the floor — surface the inferred repo so the
   * agent routes without asking "which repo?".
   */
  | { kind: "code_repo_inferred"; repo: string; reason: string }
  /** Genuinely ambiguous code work with no inferable repo — ask ONE question. */
  | { kind: "needs_repo"; reason: string };

/** Words that signal a concrete code/repo change (E4-T2 write-to-non-backlog detection). */
const CODE_WRITE_RE =
  /\b(?:in the (?:code )?repo|repo\b|repository|codebase|source code|pull request|\bpr\b|commit|deploy|merge|branch|create (?:an? )?issue in|open (?:an? )?issue in|file (?:an? )?(?:issue|ticket|bug) in)\b/i;

/** Words that signal EXECUTION (run it now) rather than just filing a ticket. */
const EXECUTE_RE = /\b(?:run|execute|launch|start it|do it now|fix|implement|build|make the change|ship)\b/i;

/**
 * Outcome/life-level epic signals (E4-T1): a goal or theme with no codebase hook. If
 * the ask reads like an outcome ("I want to be able to…", "epic:", a life goal) AND
 * carries no code-repo signal, it defaults to the life backlog — never the code lane,
 * never a "which repo?" question.
 */
const OUTCOME_RE =
  /\b(?:epic\b|i want to (?:be able to|eventually)|i'?d like to|goal\b|outcome\b|theme\b|initiative\b|long[- ]term|so that i can|the (?:big )?picture|life\b|health\b|habit\b|routine\b|personal\b)/i;

/**
 * PURE deterministic router. Given the free-text intent aimed at Archus (the backlog
 * agent), decide where it belongs WITHOUT an LLM and WITHOUT asking when avoidable.
 *
 * Precedence:
 *   1. Explicit NON-backlog repo write signal → worker_dispatch (redirect to Epaminon). [E4-T2/D4]
 *   2. Outcome/life-level epic with no code signal → life_backlog. [E4-T1/D2]
 *   3. Code-write/execute signal WITH an inferable repo → code_repo_inferred. [E4-T3/D1]
 *   4. Code-write/execute signal with NO inferable repo → needs_repo (ask once).
 *   5. Everything else → life_backlog (the safe default for the sole backlog agent).
 */
export function routeBacklogRequest(
  text: string,
  table: RepoInferenceEntry[] = DEFAULT_REPO_INFERENCE,
): BacklogRoute {
  const raw = String(text || "");
  const inferred = inferRepo(table, raw);
  const codeWrite = CODE_WRITE_RE.test(raw);
  const execute = EXECUTE_RE.test(raw);
  const outcome = OUTCOME_RE.test(raw);

  // 1. A write explicitly aimed at another repo — intercept at the router. [D4/#224]
  //    Any inferred repo that is not the life backlog, combined with a code-write
  //    signal, is an other-repo write Archus must NOT perform directly.
  if (inferred && inferred.repo !== LIFE_BACKLOG_REPO && (codeWrite || execute)) {
    return {
      kind: "worker_dispatch",
      repo: inferred.repo,
      reason: `Write aimed at code repo ${inferred.repo}; Archus writes only ${LIFE_BACKLOG_REPO}.`,
      redirect: nonBacklogRedirect(inferred.repo),
    };
  }

  // 2. Outcome-level epic with no codebase hook → the life backlog. [D2]
  if (outcome && !codeWrite && !inferred) {
    return {
      kind: "life_backlog",
      reason: "Outcome/life-level ask with no codebase signal defaults to the life backlog.",
    };
  }

  // 3./4. Concrete code work: route by the inference table, ask only below the floor.
  if (codeWrite || execute) {
    if (inferred) {
      // life backlog repo can't be a code target here; treated as life_backlog below.
      if (inferred.repo === LIFE_BACKLOG_REPO) {
        return { kind: "life_backlog", reason: "Code signal but the inferred target is the life backlog." };
      }
      return {
        kind: "code_repo_inferred",
        repo: inferred.repo,
        reason: `Inferred code repo ${inferred.repo} from the deterministic table; no need to ask which repo.`,
      };
    }
    return {
      kind: "needs_repo",
      reason: "Code/execution work with no inferable repo — ask one clarifying question for the target repo.",
    };
  }

  // 5. Default: the sole backlog agent files it in the life backlog.
  return { kind: "life_backlog", reason: "No code-repo signal; defaults to the life backlog." };
}

/**
 * The standard redirect text for a write aimed at a non-backlog repo through Archus
 * (E4-T2). "I don't do X; to do X: <route>" + an offer to hand off to Epaminon on a
 * user "yes". Deterministic and consistent so the persona cannot improvise around it.
 */
export function nonBacklogRedirect(repo: string): string {
  return [
    `I only curate the life backlog (${LIFE_BACKLOG_REPO}); I don't write ${repo} or any other code repo directly.`,
    `To change ${repo}, that goes through Epaminon, who dispatches a worker that uses the runner's existing GitHub auth on the VPS.`,
    `Want me to hand this to Epaminon to run against ${repo}? (say "yes" and I'll queue it)`,
  ].join(" ");
}

/**
 * PURE: render the router rules as a persona block so the backlog/console agents
 * follow the SAME deterministic decisions the router encodes. Injected after the
 * persona (mirrors projectRegistrySection). This is the guardrail, not the decision —
 * the decision itself is code (routeBacklogRequest) wherever a caller can consult it.
 */
export function backlogRouterSection(table: RepoInferenceEntry[] = DEFAULT_REPO_INFERENCE): string {
  const lines = table.map((entry) => {
    const desc = entry.description ? ` — ${entry.description}` : "";
    return `- ${entry.repo}${desc} [keywords: ${entry.keywords.slice(0, 6).join(", ")}]`;
  });
  return [
    "",
    "Deterministic routing rules (do NOT improvise a repo or lane):",
    `- You curate exactly ONE backlog: ${LIFE_BACKLOG_REPO}. You NEVER write any other repo directly. There is no GitHub App to install; M1 is dead.`,
    "- Outcome/life-level epics (a goal or theme with no codebase hook) go to the life backlog via backlog_create — NOT the code-execution lane, and never ask 'which repo?'.",
    "- A write aimed at any code repo other than the life backlog is intercepted: tell the user you don't write that repo, and offer to hand it to Epaminon (who dispatches a worker using the runner's gh auth). Same rule as S0-T5 (#224).",
    "- To resolve a code repo, consult this table BEFORE asking 'which repo?'; only ask when nothing matches:",
    ...lines,
  ].join("\n");
}
