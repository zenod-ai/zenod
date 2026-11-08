import type { MemoryEntry } from "zenod";
import type { InboxLink } from "./inboxStore.js";
import type { PersonaContext, PersonaDefinition, PersonaSkill } from "./personaRunner.js";

/**
 * The built-in personas (EPIC-14 S4): a catalog the user switches on one by one. Only Weekly recap
 * is on for a new user; the others stay off until switched on, and a persona that is off never
 * runs. Each is a short scheduled job inside the user's own Zenod account: it reads a window of
 * memories, makes at most one call on the cheap model (Health of your memory makes none), writes a
 * note into its own folder and leaves at most one card in the inbox. Trying them on real notes is
 * S5.
 */

const RECAP_DAYS = 7;
const RECAP_MAX_MEMORIES = 40;
const RECAP_PROMPT_CHARS = 12_000;


/**
 * What the user said, without the capture header a voice note or file carries ("Voice note … ingested",
 * "Raw artifact: …", "Transcribed by …"): the first block goes when it is that header.
 */
export function memoryWords(content: string): string {
  const blocks = content.split(/\n\s*\n/);
  const first = blocks[0] ?? "";
  const header = blocks.length > 1 && (/ingested through Zenod/i.test(first) || (first.split("\n").length >= 2 && first.split("\n").every((line) => /^[A-Z][A-Za-z0-9 ]{1,40}: /.test(line))));
  return (header ? blocks.slice(1).join("\n\n") : content).replace(/\s+/g, " ").trim();
}

/** A short name for a memory: "Voice note" or "Audio" instead of its file name. */
export function memoryTitle(entry: MemoryEntry): string {
  const media = /^(Voice note|Audio|Image|Screenshot|PDF|Document|Link) "/.exec(entry.title);
  if (media) return media[1]!;
  return entry.title.replace(/\s+/g, " ").trim().slice(0, 80);
}

function recapPrompt(entries: MemoryEntry[]): string {
  const lines: string[] = [];
  let used = 0;
  entries.forEach((entry, index) => {
    const text = memoryWords(entry.content).slice(0, 300);
    const line = `[${index + 1}] ${entry.capturedAt.slice(0, 10)} ${memoryTitle(entry)}: ${text}`;
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
  purpose: "A short recap of your week and one thing worth noticing.",
  brief: "Once a week it reads what you saved in the last 7 days, writes a short recap in its own folder and posts one finding to your inbox.",
  schedule: { every: "week" },
  skills: ["read", "write-own-folder", "post-inbox"],
  // On by default: one cheap call a week, capped at $0.10 a month; the user can switch it off.
  defaultEnabled: true,
  // One model call a week on the cheap chat model: well under a cent each run.
  limits: { maxSteps: 6, maxRunUsd: 0.02, maxMonthUsd: 0.1 },
  // Reads what was said, not the voice-note header, spread over all 7 days.
  revisedAt: "2026-11-08T19:30:00.000Z",

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
      ...(sources.length ? ["## From", "", ...sources.map((entry) => `- [[${entry.evidenceRef.replace(/\.md(?=#)/, "")}|${memoryTitle(entry)} ${entry.capturedAt.slice(0, 10)}]]`), ""] : []),
    ].join("\n"));
    if (!reply.finding) return { summary: `Read ${entries.length} memories and wrote a recap, no finding` };
    const links: InboxLink[] = [
      ...sources.slice(0, 5).map((entry) => ({ label: `${memoryTitle(entry)} ${entry.capturedAt.slice(0, 10)}`, path: entry.path })),
      { label: "This week's recap", path: notePath },
    ];
    ctx.postFinding({ title: reply.finding.title, ...(reply.finding.detail ? { body: reply.finding.detail } : {}), links });
    return { summary: `Read ${entries.length} memories, wrote a recap and posted one finding` };
  },
};

/** The reply as a JSON object when it holds one, else null. */
export function parseJsonReply(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (value: unknown, max = 300) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const nums = (value: unknown) => (Array.isArray(value) ? value.filter((n): n is number => Number.isInteger(n)) : []);
const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object") : []);

/** The memories a prompt shows, numbered, newest first, within a size budget. */
function memoryLines(entries: MemoryEntry[]): string[] {
  const lines: string[] = [];
  let used = 0;
  entries.forEach((entry, index) => {
    const line = `[${index + 1}] ${entry.capturedAt.slice(0, 10)} ${memoryTitle(entry)}: ${memoryWords(entry.content).slice(0, 300)}`;
    if (used + line.length > RECAP_PROMPT_CHARS) return;
    used += line.length;
    lines.push(line);
  });
  return lines;
}

function sourceLinks(entries: MemoryEntry[], sources: number[]): InboxLink[] {
  return sources
    .map((n) => entries[n - 1])
    .filter((entry): entry is MemoryEntry => entry !== undefined)
    .slice(0, 5)
    .map((entry) => ({ label: `${memoryTitle(entry)} ${entry.capturedAt.slice(0, 10)}`, path: entry.path }));
}

function personaNote(id: string, title: string, today: string, read: number, body: string[]): string {
  return ["---", `title: ${title} ${today}`, "type: persona-note", `persona: ${id}`, `created: ${today}`, `memories_read: ${read}`, "---", "", `# ${title} ${today}`, "", ...body, ""].join("\n");
}

interface ModelPersonaSpec {
  id: string;
  name: string;
  purpose: string;
  brief: string;
  skills: PersonaSkill[];
  days: number;
  system: string;
  /** What to reply with, as JSON. */
  ask: string;
  /** Write its note and post its card from the parsed reply; returns the run's one-line summary. */
  handle(ctx: PersonaContext, entries: MemoryEntry[], reply: Record<string, unknown> | null, notePath: string): string;
}

/** A persona that reads a window of memories and makes one call on the cheap model. Off until switched on. */
function modelPersona(spec: ModelPersonaSpec): PersonaDefinition {
  return {
    id: spec.id,
    name: spec.name,
    purpose: spec.purpose,
    brief: spec.brief,
    schedule: { every: "week" },
    skills: spec.skills,
    defaultEnabled: false,
    limits: { maxSteps: 6, maxRunUsd: 0.02, maxMonthUsd: 0.1 },
    async fingerprint(ctx) {
      const entries = await ctx.recentMemories({ days: spec.days, limit: RECAP_MAX_MEMORIES });
      return entries.length ? `${entries.length}:${entries[0]!.evidenceRef}` : null;
    },
    async run(ctx) {
      const entries = await ctx.recentMemories({ days: spec.days, limit: RECAP_MAX_MEMORIES });
      const prompt = [`These are the memories the user saved in the last ${spec.days} days, newest first:`, "", ...memoryLines(entries), "", `Reply with JSON only: ${spec.ask}`].join("\n");
      const reply = parseJsonReply(await ctx.think({ system: `You are ${spec.name}, a quiet helper that reads a person's own memory. ${spec.system} Use only what the memories say. Never invent facts, names or dates. Plain words.`, prompt }));
      return { summary: spec.handle(ctx, entries, reply, `Personas/${spec.id}/${ctx.today}.md`) };
    },
  };
}

export const OPEN_LOOPS: PersonaDefinition = modelPersona({
  id: "open-loops",
  name: "Open loops finder",
  purpose: "Finds things you said you would do and have not closed.",
  brief: "Reads the last 14 days, lists what still looks open in its own folder and asks you about the most important one.",
  skills: ["read", "write-own-folder", "post-inbox", "ask"],
  days: 14,
  system: "Find things the person said they would do, decide or check that later memories do not show as done.",
  ask: '{"loops": [{"title": "one short line", "sources": [numbers]}]} with at most 5 loops, the most important first, or an empty list.',
  handle(ctx, entries, reply, notePath) {
    const loops = list(reply?.loops).map((loop) => ({ title: str(loop.title), sources: nums(loop.sources) })).filter((loop) => loop.title).slice(0, 5);
    ctx.writeNote(`${ctx.today}.md`, personaNote("open-loops", "Open loops", ctx.today, entries.length, loops.length ? loops.map((loop) => `- ${loop.title}`) : ["- Nothing looks open."]));
    const top = loops[0];
    if (!top) return `Read ${entries.length} memories, nothing looks open`;
    ctx.postQuestion({
      title: `Is this still open? ${top.title}`,
      options: [{ id: "open", label: "Still open" }, { id: "done", label: "Done" }, { id: "drop", label: "Drop it" }],
      links: [...sourceLinks(entries, top.sources), { label: "All open loops", path: notePath }],
    });
    return `Read ${entries.length} memories, found ${loops.length} open loops and asked about one`;
  },
});

export const PEOPLE_FOLLOW_UPS: PersonaDefinition = modelPersona({
  id: "people-follow-ups",
  name: "People and follow-ups",
  purpose: "Who you talked about lately and what you owe them.",
  brief: "Reads the last 14 days, keeps a list of the people you mentioned with any follow-up in its own folder, and posts the most pressing follow-up.",
  skills: ["read", "write-own-folder", "post-inbox"],
  days: 14,
  system: "List the people the person mentions and any follow-up they owe or expect from each.",
  ask: '{"people": [{"name": "as written", "followUp": "one short line or empty", "sources": [numbers]}]} with at most 8 people, the most pressing follow-up first.',
  handle(ctx, entries, reply, notePath) {
    const people = list(reply?.people).map((p) => ({ name: str(p.name, 80), followUp: str(p.followUp), sources: nums(p.sources) })).filter((p) => p.name).slice(0, 8);
    ctx.writeNote(`${ctx.today}.md`, personaNote("people-follow-ups", "People and follow-ups", ctx.today, entries.length,
      people.length ? people.map((p) => `- ${p.name}${p.followUp ? `: ${p.followUp}` : ""}`) : ["- Nobody mentioned."]));
    const due = people.find((p) => p.followUp);
    if (!due) return `Read ${entries.length} memories, ${people.length} people, no follow-up`;
    ctx.postFinding({ title: `${due.name}: ${due.followUp}`, links: [...sourceLinks(entries, due.sources), { label: "Everyone this fortnight", path: notePath }] });
    return `Read ${entries.length} memories, ${people.length} people, posted one follow-up`;
  },
});

export const TOPIC_GARDENER: PersonaDefinition = modelPersona({
  id: "topic-gardener",
  name: "Topic gardener",
  purpose: "Spots one tidy-up in your topics and offers it as a job you can run.",
  brief: "Reads the last 30 days and proposes one tidy-up, like joining two topics that are the same thing. It changes nothing itself: you press Run it, or Not now.",
  skills: ["read", "write-own-folder", "propose-desk-job"],
  days: 30,
  system: "Look for one tidy-up of how these memories are filed: two names for the same topic, one topic that has grown into two, or a stray memory in the wrong place.",
  ask: '{"tidy": {"request": "the job as the person would ask it, one sentence", "why": "one sentence"}} or {"tidy": null} when nothing needs tidying.',
  handle(ctx, entries, reply) {
    const tidy = reply?.tidy && typeof reply.tidy === "object" ? (reply.tidy as Record<string, unknown>) : null;
    const request = str(tidy?.request, 600);
    const why = str(tidy?.why);
    ctx.writeNote(`${ctx.today}.md`, personaNote("topic-gardener", "Topic gardener", ctx.today, entries.length, request ? [`- Proposed: ${request}`, `- Why: ${why}`] : ["- Nothing needs tidying."]));
    if (!request) return `Read ${entries.length} memories, nothing to tidy`;
    ctx.proposeDeskJob({ request, why: why || "One tidy-up for your topics." });
    return `Read ${entries.length} memories and proposed one tidy-up`;
  },
});

export const IDEAS_DIGEST: PersonaDefinition = modelPersona({
  id: "ideas-digest",
  name: "Ideas digest",
  purpose: "Collects the ideas you had into one digest.",
  brief: "Reads the last 14 days, gathers your ideas into one digest in its own folder and posts the one you came back to most.",
  skills: ["read", "write-own-folder", "post-inbox"],
  days: 14,
  system: "Collect the ideas the person had: plans, what-ifs, things to try or build. Not tasks or facts.",
  ask: '{"ideas": [{"title": "one short line", "sources": [numbers]}]} with at most 8 ideas, the one they came back to most first, or an empty list.',
  handle(ctx, entries, reply, notePath) {
    const ideas = list(reply?.ideas).map((idea) => ({ title: str(idea.title), sources: nums(idea.sources) })).filter((idea) => idea.title).slice(0, 8);
    ctx.writeNote(`${ctx.today}.md`, personaNote("ideas-digest", "Ideas digest", ctx.today, entries.length, ideas.length ? ideas.map((idea) => `- ${idea.title}`) : ["- No ideas this time."]));
    const top = ideas[0];
    if (!top) return `Read ${entries.length} memories, no ideas`;
    ctx.postFinding({ title: `${ideas.length} ideas this fortnight. Most on your mind: ${top.title}`, links: [...sourceLinks(entries, top.sources), { label: "The digest", path: notePath }] });
    return `Read ${entries.length} memories and collected ${ideas.length} ideas`;
  },
});

const HEALTH_DAYS = 28;

/** No model: counts only. Tells you when capture has gone quiet or many memories are nearly empty. */
export const MEMORY_HEALTH: PersonaDefinition = {
  id: "memory-health",
  name: "Health of your memory",
  purpose: "Tells you when saving has gone quiet or memories are nearly empty.",
  brief: "Once a week it counts what you saved in the last 4 weeks, with no AI call and no cost, writes the numbers in its own folder and posts only when something stands out.",
  schedule: { every: "week" },
  skills: ["read", "write-own-folder", "post-inbox"],
  defaultEnabled: false,
  limits: { maxSteps: 4, maxRunUsd: 0.001, maxMonthUsd: 0.001 },

  async fingerprint(ctx) {
    const entries = await ctx.recentMemories({ days: HEALTH_DAYS, limit: 100 });
    return entries.length ? `${entries.length}:${entries[0]!.evidenceRef}` : null;
  },

  async run(ctx) {
    const entries = await ctx.recentMemories({ days: HEALTH_DAYS, limit: 100 });
    const today = Date.parse(`${ctx.today}T00:00:00Z`);
    const week = (entry: MemoryEntry) => Math.min(3, Math.floor((today + 24 * 3_600_000 - Date.parse(entry.capturedAt)) / (7 * 24 * 3_600_000)));
    const perWeek = [0, 0, 0, 0];
    for (const entry of entries) perWeek[week(entry)]! += 1;
    const days = new Set(entries.filter((entry) => week(entry) === 0).map((entry) => entry.capturedAt.slice(0, 10))).size;
    const thin = entries.filter((entry) => memoryWords(entry.content).split(" ").filter(Boolean).length < 5).length;
    ctx.writeNote(`${ctx.today}.md`, personaNote("memory-health", "Health of your memory", ctx.today, entries.length, [
      `- Saved this week: ${perWeek[0]}, the three weeks before: ${perWeek[1]}, ${perWeek[2]}, ${perWeek[3]}`,
      `- Days with something saved this week: ${days} of 7`,
      `- Nearly empty memories, under 5 words: ${thin} of ${entries.length}`,
    ]));
    const before = (perWeek[1]! + perWeek[2]! + perWeek[3]!) / 3;
    const quiet = before >= 3 && perWeek[0]! < before / 2;
    const empty = entries.length >= 5 && thin / entries.length > 0.3;
    if (!quiet && !empty) return { summary: `Counted ${entries.length} memories, all looks normal` };
    ctx.postFinding({
      title: quiet
        ? `You saved ${perWeek[0]} memories this week, against about ${Math.round(before)} a week before.`
        : `${thin} of your last ${entries.length} memories are nearly empty.`,
      links: [{ label: "The numbers", path: `Personas/memory-health/${ctx.today}.md` }],
    });
    return { summary: `Counted ${entries.length} memories and posted one finding` };
  },
};

/** Every persona the runner knows, in catalog order. Only Weekly recap is on by default. */
export const BUILT_IN_PERSONAS: readonly PersonaDefinition[] = [WEEKLY_RECAP, OPEN_LOOPS, PEOPLE_FOLLOW_UPS, TOPIC_GARDENER, IDEAS_DIGEST, MEMORY_HEALTH];

export function personaById(id: string): PersonaDefinition | null {
  return BUILT_IN_PERSONAS.find((persona) => persona.id === id) ?? null;
}
