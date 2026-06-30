import { readFileSync } from "node:fs";

/**
 * Project registry (#stab T4). The front-end agents kept asking "which repo?" for
 * work the user expects them to already know (e.g. "the DIOPTRA bot"). This maps the
 * user's informal aliases to the concrete repo + path + deploy facts so an execution
 * can be dispatched without a clarification round-trip, and so the agent never
 * over-claims that a push is "live" when redeploy is unconfirmed.
 *
 * The registry is code (version-controlled, ships with the image) and can be overridden
 * at runtime with a JSON file via ZENOD_PROJECTS_FILE for ops flexibility.
 */
export interface ProjectEntry {
  /** Informal names the user uses, lowercased for matching ("dioptra", "optra bot"). */
  aliases: string[];
  /** Canonical GitHub repo as owner/repo. */
  repo: string;
  /** Sub-path within the repo where the relevant code lives, if not the whole repo. */
  path?: string;
  /** What this project is, one line — surfaced to the agent so it can resolve confidently. */
  description?: string;
  /** Honest deploy facts: how/whether a push goes live. NEVER claim "live" without confirming. */
  deployNote?: string;
  /** Optional health/version URL a run can poll to confirm a redeploy actually landed. */
  deployHealthUrl?: string;
}

export const DEFAULT_PROJECTS: ProjectEntry[] = [
  {
    aliases: ["dioptra", "optra", "dioptra bot", "optra bot", "dioptra telegram bot", "the twitter bot", "telegram bot"],
    repo: "AlfaBlok/idea_scraper",
    path: "ideascraper-vps-v1/telegram-bot",
    description:
      "DIOPTRA/OPTRA — the idea/idealista-scraper Telegram bot. Its rich-text response formatting (prompt + renderer) lives under the telegram-bot path.",
    deployNote:
      "Redeploy is NOT guaranteed to be automatic — a commit on main may not be live until the container picks it up. Confirm the running container reflects the new commit before telling the user it is live.",
  },
];

function normalize(s: string): string {
  return String(s || "").toLowerCase().replace(/[_\-./]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Load the registry: a valid ZENOD_PROJECTS_FILE JSON array wins; otherwise the built-ins. */
export function loadProjectRegistry(env: NodeJS.ProcessEnv = process.env): ProjectEntry[] {
  const file = env.ZENOD_PROJECTS_FILE;
  if (file) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) return parsed.filter((p) => p && typeof p.repo === "string" && Array.isArray(p.aliases));
    } catch {
      // fall through to built-ins; a broken override must not blank the registry
    }
  }
  return DEFAULT_PROJECTS;
}

/**
 * PURE: resolve a free-text reference ("the dioptra bot", "idea_scraper") to one project.
 * Matches an exact owner/repo, then an exact alias, then an alias contained in the query.
 * Returns null when nothing matches confidently (caller should then ask, not guess).
 */
export function resolveProject(registry: ProjectEntry[], query: string): ProjectEntry | null {
  const q = normalize(query);
  if (!q) return null;
  // Exact repo (owner/repo or just the repo name).
  for (const p of registry) {
    const repoNorm = normalize(p.repo);
    if (q === repoNorm || q === normalize(p.repo.split("/").pop() || "")) return p;
  }
  // Exact alias.
  for (const p of registry) {
    if (p.aliases.some((a) => normalize(a) === q)) return p;
  }
  // Alias appears as a whole-word phrase inside the query.
  let best: { p: ProjectEntry; len: number } | null = null;
  for (const p of registry) {
    for (const a of p.aliases) {
      const an = normalize(a);
      if (!an) continue;
      const re = new RegExp(`(^|\\s)${an.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
      if (re.test(q) && (!best || an.length > best.len)) best = { p, len: an.length };
    }
  }
  return best?.p ?? null;
}

/** PURE: render the registry as a persona block so the agent resolves repos without asking. */
export function projectRegistrySection(registry: ProjectEntry[]): string {
  if (!registry.length) return "";
  const lines = registry.map((p) => {
    const where = p.path ? `${p.repo} (path: ${p.path})` : p.repo;
    const desc = p.description ? ` — ${p.description}` : "";
    const aliases = p.aliases.length ? ` [aliases: ${p.aliases.join(", ")}]` : "";
    const deploy = p.deployNote ? ` Deploy: ${p.deployNote}` : "";
    return `- ${where}${desc}${aliases}${deploy}`;
  });
  return [
    "",
    "Known projects (resolve the user's informal names to these WITHOUT asking which repo):",
    ...lines,
    "When a request names a project below, dispatch the run against its repo/path directly. Only ask if the reference matches none of these.",
  ].join("\n");
}
