import type { MemoryEntry } from "zenod";
import type { InboxLink } from "./inboxStore.js";
import type { PersonaDefinition } from "./personaRunner.js";

/**
 * The built-in personas (EPIC-14 S4). One simple demo persona for now; the three starter personas
 * tried on real notes come next (S5) and are added here the same way.
 */

const RECAP_DAYS = 7;
const RECAP_MAX_MEMORIES = 40;
const RECAP_PROMPT_CHARS = 12_000;

const READS_WRITES = [
  "Reads your memory",
  "Writes only into its own folder",
  "Posts findings to your inbox",
  "Never messages anyone",
];

function recapPrompt(entries: MemoryEntry[]): string {
  const lines: string[] = [];
  let used = 0;
  entries.forEach((entry, index) => {
    const text = entry.content.replace(/\s+/g, " ").trim().slice(0, 400);
    const line = `[${index + 1}] ${entry.capturedAt.slice(0, 10)} ${entry.title}: ${text}`;
    if (used + line.length > RECAP_PROMPT_CHARS) return;
    used += line.length;
    lines.push(line);
  });
  return [
    `These are the memories the user saved in the last ${RECAP_DAYS} days, newest first:`,
    "",
    ...lines,
    "",
    'Reply with JSON only: {"recap": ["3 to 5 short bullets"], "finding": {"title": "one sentence", "detail": "one or two sentences", "sources": [numbers]}}',
  ].join("\n");
}

const RECAP_SYSTEM = [
  "You are Weekly recap, a quiet helper that reads a person's own memory once a week.",
  "Write a short recap of the week in their words, then pick ONE finding: a pattern, a loose end, or something they said they would do and have not mentioned since.",
  "Use only what the memories say. Never invent facts, names or dates. Plain words, no advice beyond the finding.",
].join(" ");

interface RecapReply {
  recap: string[];
  finding: { title: string; detail: string; sources: number[] } | null;
}

/** Read the model's reply leniently: JSON when it is JSON, else the text as one recap line. */
export function parseRecapReply(text: string): RecapReply {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const value = JSON.parse(json) as { recap?: unknown; finding?: { title?: unknown; detail?: unknown; sources?: unknown } };
    const recap = Array.isArray(value.recap) ? value.recap.filter((line): line is string => typeof line === "string" && line.trim() !== "").map((line) => line.trim()).slice(0, 5) : [];
    const title = typeof value.finding?.title === "string" ? value.finding.title.trim() : "";
    const finding = title
      ? {
          title,
          detail: typeof value.finding?.detail === "string" ? value.finding.detail.trim() : "",
          sources: Array.isArray(value.finding?.sources) ? value.finding.sources.filter((n): n is number => Number.isInteger(n)) : [],
        }
      : null;
    if (recap.length || finding) return { recap, finding };
  } catch {
    // fall through
  }
  const plain = text.trim();
  return { recap: plain ? [plain.slice(0, 500)] : [], finding: null };
}

export const WEEKLY_RECAP: PersonaDefinition = {
  id: "weekly-recap",
  name: "Weekly recap",
  brief: "Once a week it reads what you saved in the last 7 days, writes a short recap in its own folder and posts one finding to your inbox.",
  schedule: { every: "week" },
  permissions: READS_WRITES,
  // On by default: one cheap call a week, capped at $0.10 a month; the user can switch it off.
  defaultEnabled: true,
  // One model call a week on the cheap chat model: well under a cent each run.
  limits: { maxSteps: 6, maxRunUsd: 0.02, maxMonthUsd: 0.1 },

  async fingerprint(ctx) {
    const entries = await ctx.recentMemories({ days: RECAP_DAYS, limit: RECAP_MAX_MEMORIES });
    if (entries.length === 0) return null;
    return `${entries.length}:${entries[0]!.evidenceRef}`;
  },

  async run(ctx) {
    const entries = await ctx.recentMemories({ days: RECAP_DAYS, limit: RECAP_MAX_MEMORIES });
    const reply = parseRecapReply(await ctx.think({ system: RECAP_SYSTEM, prompt: recapPrompt(entries) }));
    const notePath = `Personas/weekly-recap/${ctx.today}.md`;
    const sources = (reply.finding?.sources ?? [])
      .map((n) => entries[n - 1])
      .filter((entry): entry is MemoryEntry => entry !== undefined);
    ctx.writeNote(`${ctx.today}.md`, [
      "---",
      `title: Weekly recap ${ctx.today}`,
      "type: persona-note",
      "persona: weekly-recap",
      `created: ${ctx.today}`,
      `memories_read: ${entries.length}`,
      "---",
      "",
      `# Weekly recap ${ctx.today}`,
      "",
      ...(reply.recap.length ? reply.recap.map((line) => `- ${line}`) : ["- Nothing to recap."]),
      "",
      ...(reply.finding ? ["## Finding", "", reply.finding.title, "", ...(reply.finding.detail ? [reply.finding.detail, ""] : [])] : []),
      ...(sources.length ? ["## From", "", ...sources.map((entry) => `- [[${entry.evidenceRef.replace(/\.md(?=#)/, "")}|${entry.title}]]`), ""] : []),
    ].join("\n"));
    if (!reply.finding) return { summary: `Read ${entries.length} memories and wrote a recap, no finding` };
    const links: InboxLink[] = [
      ...sources.slice(0, 5).map((entry) => ({ label: entry.title.slice(0, 120), path: entry.path })),
      { label: "This week's recap", path: notePath },
    ];
    ctx.postFinding({ title: reply.finding.title, ...(reply.finding.detail ? { body: reply.finding.detail } : {}), links });
    return { summary: `Read ${entries.length} memories, wrote a recap and posted one finding` };
  },
};

/** Every persona the runner knows, built-in first. */
export const BUILT_IN_PERSONAS: readonly PersonaDefinition[] = [WEEKLY_RECAP];

export function personaById(id: string): PersonaDefinition | null {
  return BUILT_IN_PERSONAS.find((persona) => persona.id === id) ?? null;
}
