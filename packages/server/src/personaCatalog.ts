import type { MemoryEntry } from "zenod";
import type { InboxLink } from "./inboxStore.js";
import type { PersonaContext, PersonaDefinition, PersonaSchedule, PersonaSkill } from "./personaRunner.js";
import { hasWorkCode, isProjectWork } from "./helperScope.js";
import { createClarifier } from "./clarifier.js";
import { createPatterns } from "./patterns.js";
import { cleanHelperCard, HELPER_CARD_ASK, HELPER_CARD_WORDS, namedCard, namedMemories, pictureTitle, pictureWords, type HelperCard } from "./helperCard.js";

/**
 * The built-in personas (EPIC-14 S4): a catalog the user switches on one by one. Only Weekly recap
 * is on for a new user; the others stay off until switched on, and a persona that is off never
 * runs. Each is a short scheduled job inside the user's own Zenod account: it reads a window of
 * memories, makes at most one call on the cheap model (Health of your memory makes none), writes a
 * note into its own folder and leaves at most one card in the inbox. Trying them on real notes is
 * S5.
 *
 * S27 round 2 (Jordi, 2026-11-10: "His job should be to work on the memory, and the memory is not
 * the repos, it's my memory"): every helper keeps to the person's memory, its notes and how they are
 * kept, and never manages a project. The runner leaves out the work-tracking records agents save
 * (helperScope.ts); the words below say so to the model; a card or list line about project work is
 * dropped before it is posted.
 */

/** Said to every helper's model: memory work only, never project management. */
export const MEMORY_ONLY = [
  "You work on this person's memory only: their own notes and how they are kept.",
  "You are not a project manager. Never suggest a next step in a project, a task, a ticket, an epic, a repository, a release or a deploy, and never plan or pick work for a team or an agent.",
  "Many notes are about their work projects: treat a project only as something the notes are about.",
].join(" ");

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

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * S36: each memory as the person knows it, for a card: "your voice note of 3 Nov", or a note's own
 * name in quotes. The model numbers what it read; a card says these words instead.
 */
export function memoryPhrases(entries: ReadonlyArray<MemoryEntry>): string[] {
  return entries.map((entry) => {
    const title = memoryTitle(entry);
    const day = Number.isNaN(Date.parse(entry.capturedAt)) ? "" : ` of ${SHORT_DATE.format(new Date(entry.capturedAt))}`;
    const media = /^(Voice note|Audio|Image|Screenshot|PDF|Document|Link)$/.exec(title);
    return media ? `your ${media[1]!.toLowerCase()}${day}` : `your note "${title.slice(0, 60)}"`;
  });
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
  MEMORY_ONLY,
  "Write a short recap of the week in their words, then pick ONE finding about their memory or their own life: a pattern in what they keep coming back to, a loose end in their life, or something they said they would do and have not mentioned since. Never a project's status or next step.",
  "Use only what the memories say. Never invent facts, names or dates. Plain words, no advice beyond the finding.",
  HELPER_CARD_WORDS,
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
  // EPIC-23 E23-A2: off by default, so testers start with memory only; accounts that used helpers
  // before 2026-11-11 keep it on (personasFor). One cheap call a week, capped at $0.10 a month.
  defaultEnabled: false,
  // One model call a week on the cheap chat model: well under a cent each run.
  limits: { maxSteps: 6, maxRunUsd: 0.02, maxMonthUsd: 0.1 },
  // S27 round 2: memory only, never a project's next step.
  revisedAt: "2026-11-10T04:15:00.000Z",

  async fingerprint(ctx) {
    const entries = await ctx.recentMemories({ days: RECAP_DAYS, limit: RECAP_MAX_MEMORIES });
    if (entries.length === 0) return null;
    return `${entries.length}:${entries[0]!.evidenceRef}`;
  },

  async run(ctx) {
    const entries = await ctx.recentMemories({ days: RECAP_DAYS, limit: RECAP_MAX_MEMORIES });
    const raw = parseRecapReply(await ctx.think({ system: RECAP_SYSTEM, prompt: recapPrompt(entries) }));
    // S27 round 2: a finding about project work is left out; the recap lines stay.
    const reply = raw.finding && isProjectWork(raw.finding.title, raw.finding.detail) ? { ...raw, finding: null } : raw;
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
    // S36: the finding names memories the way the person knows them, never by the model's numbers.
    const said = memoryPhrases(entries);
    const detail = namedMemories(reply.finding.detail, said);
    ctx.postFinding({ title: namedMemories(reply.finding.title, said), ...(detail ? { body: detail } : {}), links });
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

/**
 * S27: what a helper may offer as a change. Do it hands the words to the memory desk as one job, and
 * the desk can only do these, so a suggestion outside them would fail when pressed.
 */
const DESK_CAN = [
  "The memory desk can do only these changes: move a page under another place, give a page its own place at the top of the tree, rename a place, link two memories so each shows the other, or unlink them.",
  "It never writes new words, never creates or deletes a page and never edits what the person said.",
].join(" ");

const SUGGESTION_ASK = `"suggestion": {"title": "one sentence the person reads first", "action": "the one change, as the person would ask the memory desk, naming places exactly as listed", ${HELPER_CARD_ASK}, "sources": [numbers]} or "suggestion": null`;

/** A helper's suggestion from its reply, or null. S36: `card` is its picture, why yes and why not. */
export function parseSuggestion(reply: Record<string, unknown> | null): { title: string; why: string; action: string; sources: number[]; card: HelperCard | null } | null {
  const raw = reply?.suggestion && typeof reply.suggestion === "object" ? (reply.suggestion as Record<string, unknown>) : null;
  const title = str(raw?.title);
  const action = str(raw?.action, 600);
  if (!title || !action) return null;
  const card = cleanHelperCard(raw);
  // Before S36 the reason came as `why`; a card's why yes is the same line.
  return { title, why: card?.yes ?? str(raw?.why), action, sources: nums(raw?.sources), card };
}

/**
 * S27 round 2: a suggestion about project work never reaches the inbox: a work code anywhere, or
 * project-management words in what the person reads first (the change itself names pages, which
 * may hold any word).
 */
export function aboutProjectWork(suggestion: { title: string; why: string; action: string; card?: HelperCard | null }): boolean {
  return hasWorkCode(suggestion.action) || isProjectWork(suggestion.title, suggestion.why) || (suggestion.card?.no ? isProjectWork(suggestion.card.no) : false);
}

function earlierLines(ctx: PersonaContext): string[] {
  if (!ctx.earlierSuggestions.length) return [];
  return [
    "",
    "Your earlier suggestions and what the person did. Never suggest one of these again, and after a Not now stop suggesting that kind of change:",
    ...ctx.earlierSuggestions.map((s) => `- ${s.status}${s.reason ? ` (${s.reason.slice(0, 200)})` : ""}: ${s.action.slice(0, 200)}`),
  ];
}

interface ModelPersonaSpec {
  id: string;
  name: string;
  purpose: string;
  brief: string;
  skills: PersonaSkill[];
  schedule: PersonaSchedule;
  days: number;
  system: string;
  /** S27: the kind of change it may offer, within what the desk can do. */
  suggests: string;
  /** What to reply with, as JSON, besides the suggestion. */
  ask: string;
  /**
   * Write its note and post its one card from the parsed reply; returns the run's one-line summary.
   * `suggestion` is the change it offers, already checked; it posts that instead of its old card.
   */
  handle(ctx: PersonaContext, entries: MemoryEntry[], reply: Record<string, unknown> | null, notePath: string, suggestion: (NonNullable<ReturnType<typeof parseSuggestion>> & { team?: string }) | null): string;
}

/** When the helpers kept to the memory only (S27 round 2): each wakes once more at once, in its own period. */
const SUGGESTS_SINCE = "2026-11-10T04:15:00.000Z";
/** S36: when the helpers' cards took Jordi's shape (picture, why yes, why not), and again once a card left out asks for it: each wakes once more. */
const CARDS_SINCE = "2026-11-11T02:00:00.000Z";

/**
 * S35: what a helper may ask the Team desk. Read only: how something in the memories connects to
 * the person's projects, milestones and plans; never to pick, start or change work.
 */
const TEAM_QUESTION_ASK = '"teamQuestion": "one short question in plain words for the person\'s team desk about how something in these memories connects to their projects, milestones or plans, or null when no memory touches a plan, decision or project of theirs"';
/** S35 round 2: on DeepSeek the cautious wording above alone never asked; the system words say when to ask. */
const TEAM_ASK_SYSTEM = "This run you may ask the person's team desk ONE question in teamQuestion. The desk only reads the state of their projects, milestones and plans and answers in words; it never does anything. Ask it whenever a memory touches a plan, a decision or a project of theirs, so you know how that memory connects before you suggest where it belongs or what to link. The answer is context for organising their memory, never a task.";
const TEAM_ANSWER_ASK = '"usedTeamAnswer": true when the team\'s answer changed or supports your suggestion, else false';

/** S35: the team's answer in the helper's words: context only, never a task. */
function teamAnswerLines(asked: { question: string; answer: string; refs: string[] }): string[] {
  return [
    "",
    "You asked the person's team desk, which only reads their projects' state:",
    `Question: ${asked.question}`,
    `Answer: ${asked.answer}${asked.refs.length ? ` (about: ${asked.refs.join(", ")})` : ""}`,
    "Use it only as context for how their memory is organised. It is never a task for you or the person.",
  ];
}

/** S35: the line on the card and in the note when the team's answer was used. */
export function askedTeamLine(asked: { question: string; answer: string }): string {
  const answer = asked.answer.length > 280 ? `${asked.answer.slice(0, 279).trimEnd()}…` : asked.answer;
  return `Asked the team: ${asked.question} They said: ${answer}`;
}

/** A persona that reads a window of memories and the tree, and makes one call on the cheap model (two when it asks the team). Off until switched on. */
function modelPersona(spec: ModelPersonaSpec): PersonaDefinition {
  return {
    id: spec.id,
    name: spec.name,
    purpose: spec.purpose,
    brief: spec.brief,
    schedule: spec.schedule,
    skills: spec.skills,
    defaultEnabled: false,
    // S35: two more steps when it asks the team: the question and the second call with the answer.
    // S36: one more when its suggestion came without its card and it asks for the card alone.
    limits: { maxSteps: 10, maxRunUsd: 0.02, maxMonthUsd: 0.1 },
    // S36: a helper with a card wakes once more to say it Jordi's way (S35 round 2 woke them at 10:50Z for its clearer words).
    revisedAt: CARDS_SINCE,
    asksTeam: true,
    async fingerprint(ctx) {
      const entries = await ctx.recentMemories({ days: spec.days, limit: RECAP_MAX_MEMORIES });
      return entries.length ? `${entries.length}:${entries[0]!.evidenceRef}` : null;
    },
    async run(ctx) {
      const entries = await ctx.recentMemories({ days: spec.days, limit: RECAP_MAX_MEMORIES });
      const places = await ctx.places();
      const canSuggest = places !== null && places.lines.length > 0;
      const mayAsk = canSuggest && ctx.canAskTeam;
      const promptWith = (extra: string[], reply: string) => [
        `These are the memories the user saved in the last ${spec.days} days, newest first:`,
        "",
        ...memoryLines(entries),
        ...(canSuggest ? ["", "The places in their memory, as the memory desk knows them:", ...places.lines] : []),
        ...(canSuggest ? earlierLines(ctx) : []),
        ...extra,
        "",
        `Reply with JSON only: {${spec.ask}${canSuggest ? `, ${SUGGESTION_ASK}` : ""}${reply}}`,
      ].join("\n");
      const prompt = promptWith([], mayAsk ? `, ${TEAM_QUESTION_ASK}` : "");
      const system = [
        `You are ${spec.name}, a quiet helper that reads a person's own memory.`,
        MEMORY_ONLY,
        spec.system,
        ...(canSuggest ? [`You may also offer ONE change to how their memory is organised: ${spec.suggests}`, DESK_CAN, "Offer a change only when the memories clearly call for it; otherwise suggestion is null."] : []),
        ...(mayAsk ? [TEAM_ASK_SYSTEM] : []),
        "Use only what the memories say. Never invent facts, names or dates. Plain words.",
        HELPER_CARD_WORDS,
      ].join(" ");
      let reply = parseJsonReply(await ctx.think({ system, prompt }));
      // S35: at most one question to the Team desk, then one more call with its answer as context.
      const raw = mayAsk ? str(reply?.teamQuestion, 300) : "";
      const question = raw.length >= 8 && !/^(null|none|no)\.?$/i.test(raw) ? raw : "";
      const asked = question ? await ctx.askTeam(question) : null;
      let usedTeam = false;
      if (asked) {
        const second = parseJsonReply(await ctx.think({ system, prompt: promptWith(teamAnswerLines(asked), `, ${TEAM_ANSWER_ASK}`) }));
        if (second) {
          reply = second;
          usedTeam = second.usedTeamAnswer === true;
        }
      }
      let offered: Offered | null = canSuggest ? parseSuggestion(reply) : null;
      const leftOut = offered !== null && aboutProjectWork(offered);
      if (offered && !leftOut && !offered.card) offered = { ...offered, ...(await askForCard(ctx, system, promptWith([], ""), offered)) };
      if (offered) {
        // S36: the card names memories the way the person knows them, never by the model's numbers.
        const said = memoryPhrases(entries);
        offered = { ...offered, title: namedMemories(offered.title, said), why: namedMemories(offered.why, said), card: offered.card ? namedCard(offered.card, said) : null };
      }
      if (offered && !leftOut && asked && usedTeam) offered = { ...offered, team: askedTeamLine(asked) };
      const summary = spec.handle(ctx, entries, reply, `Personas/${spec.id}/${ctx.today}.md`, leftOut ? null : offered);
      const teamWords = asked ? `; asked the team one question${usedTeam ? " and used the answer" : ""}` : question ? "; the team gave no answer" : "";
      return { summary: `${leftOut ? `${summary}; left out one suggestion about project work` : summary}${teamWords}` };
    },
  };
}

/**
 * S36: on DeepSeek a second call (after the team's answer) sometimes leaves the card out, and the
 * suggestion would reach the person with no picture and no reasons. One short call asks for the card
 * alone; without it the old card stays. Its words fill `why` too, as before S36.
 */
async function askForCard(ctx: PersonaContext, system: string, prompt: string, offered: { action: string }): Promise<{ card: HelperCard; why: string } | Record<string, never>> {
  try {
    const reply = parseJsonReply(await ctx.think({ system, prompt: [prompt, "", `You suggested this change: ${offered.action}`, `Now reply with JSON only, for that change: {${HELPER_CARD_ASK}}`].join("\n") }));
    const card = cleanHelperCard(reply);
    return card?.yes ? { card, why: card.yes } : {};
  } catch {
    // A cap or a failed call: the suggestion is still worth posting, in the old card.
    return {};
  }
}

/** A helper's suggestion as it posts it: S35's line about what the team said rides along. */
type Offered = NonNullable<ReturnType<typeof parseSuggestion>> & { team?: string };

/**
 * S27: post the helper's one suggestion with its sources and its note. S36: with a card, its first
 * line says the change in plain words from the picture, and why yes and why not sit on the card; the
 * body keeps only what the team said.
 */
function postSuggestionCard(ctx: PersonaContext, entries: MemoryEntry[], suggestion: Offered, note: InboxLink): void {
  const card = suggestion.card;
  const body = card ? suggestion.team : [suggestion.why, suggestion.team].filter(Boolean).join("\n\n");
  ctx.postSuggestion({
    title: card?.picture ? pictureTitle(card.picture) : suggestion.title,
    ...(body ? { body } : {}),
    action: suggestion.action,
    links: [...sourceLinks(entries, suggestion.sources), note],
    ...(card ? { card } : {}),
  });
}

/** The suggestion in the helper's own note: the change, why yes, why not, and the team's answer. */
const suggestionLines = (suggestion: Offered | null, lead: string) => suggestion
  ? [`- ${lead}${suggestion.action}`, ...(suggestion.card?.picture ? [`- Picture: ${pictureWords(suggestion.card.picture)}`] : []), ...(suggestion.why ? [`- Why: ${suggestion.why}`] : []), ...(suggestion.card?.no ? [`- Why not: ${suggestion.card.no}`] : []), ...(suggestion.team ? ["", suggestion.team] : [])]
  : [];
const suggestionNote = (suggestion: Offered | null) => (suggestion ? ["", "## Suggested", "", ...suggestionLines(suggestion, "")] : []);

export const OPEN_LOOPS: PersonaDefinition = modelPersona({
  id: "open-loops",
  name: "Open loops finder",
  purpose: "Finds loose ends in your own life that your notes leave open.",
  brief: "Every night it reads what you said in the last 14 days and lists the loose ends in your own life, like a call to make or a form to send, in its own folder. It suggests one change to your memory, like linking a loose end to the note that closed it, or asks you whether the most important one is still open. It never tracks your projects' work.",
  skills: ["read", "write-own-folder", "post-inbox", "ask", "propose-desk-job"],
  schedule: { every: "night" },
  days: 14,
  system: "Find loose ends in the person's own life: things they said they would do, decide or check (home, health, money, family, friends, travel, paperwork) that later memories do not show as done. Work on a project is not a loose end here.",
  suggests: "link the memory where they left a loose end to the later memory that closes it, or to the place it belongs, so the loose end is easy to find and close.",
  ask: '"loops": [{"title": "one short line", "sources": [numbers]}] with at most 5 loose ends, the most important first, or an empty list',
  handle(ctx, entries, reply, notePath, suggestion) {
    const loops = list(reply?.loops).map((loop) => ({ title: str(loop.title), sources: nums(loop.sources) })).filter((loop) => loop.title && !isProjectWork(loop.title)).slice(0, 5);
    ctx.writeNote(`${ctx.today}.md`, personaNote("open-loops", "Open loops", ctx.today, entries.length, [...(loops.length ? loops.map((loop) => `- ${loop.title}`) : ["- No loose ends in your own life."]), ...suggestionNote(suggestion)]));
    if (suggestion) {
      postSuggestionCard(ctx, entries, suggestion, { label: "All open loops", path: notePath });
      return `Read ${entries.length} memories, found ${loops.length} open loops and suggested one change`;
    }
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
  purpose: "The people in your notes lately and what you owe them.",
  brief: "Every night it reads what you said in the last 14 days and keeps a list of the people you mentioned, with any follow-up like a call, a reply or a thank-you, in its own folder. It suggests one change to your memory, like linking a follow-up to that person's page, or posts the most pressing follow-up. Agents and project roles are not people here.",
  skills: ["read", "write-own-folder", "post-inbox", "propose-desk-job"],
  schedule: { every: "night" },
  days: 14,
  system: "List the real people the person mentions (family, friends, colleagues, people they met) and any personal follow-up they owe or expect from each: a call, a reply, a visit, a thank-you, something to return. AI agents, bots and project roles are not people; a project's work is not a follow-up.",
  suggests: "link the memory with the most pressing follow-up to the page of the person it is about, when that person has a place, or give a person who keeps coming up their own place.",
  ask: '"people": [{"name": "as written", "followUp": "one short line or empty", "sources": [numbers]}] with at most 8 people, the most pressing follow-up first',
  handle(ctx, entries, reply, notePath, suggestion) {
    const people = list(reply?.people).map((p) => ({ name: str(p.name, 80), followUp: str(p.followUp), sources: nums(p.sources) })).filter((p) => p.name && !isProjectWork(p.name, p.followUp)).slice(0, 8);
    ctx.writeNote(`${ctx.today}.md`, personaNote("people-follow-ups", "People and follow-ups", ctx.today, entries.length,
      [...(people.length ? people.map((p) => `- ${p.name}${p.followUp ? `: ${p.followUp}` : ""}`) : ["- Nobody mentioned."]), ...suggestionNote(suggestion)]));
    if (suggestion) {
      postSuggestionCard(ctx, entries, suggestion, { label: "Everyone this fortnight", path: notePath });
      return `Read ${entries.length} memories, ${people.length} people, suggested one change`;
    }
    const due = people.find((p) => p.followUp);
    if (!due) return `Read ${entries.length} memories, ${people.length} people, no follow-up`;
    ctx.postFinding({ title: `${due.name}: ${due.followUp}`, links: [...sourceLinks(entries, due.sources), { label: "Everyone this fortnight", path: notePath }] });
    return `Read ${entries.length} memories, ${people.length} people, posted one follow-up`;
  },
});

export const TOPIC_GARDENER: PersonaDefinition = modelPersona({
  id: "topic-gardener",
  name: "Topic gardener",
  purpose: "Spots one tidy-up in how your memory is kept and offers it as a change you can make.",
  brief: "Every 3 days it reads what you said in the last 30 days and the tree and suggests one tidy-up of your memory, like a note filed in the wrong place, two notes about the same thing to link, or a place to rename to what you call it. It changes nothing itself: you press Do it, Change or Not now.",
  skills: ["read", "write-own-folder", "propose-desk-job"],
  schedule: { every: "days", days: 3 },
  days: 30,
  system: "Look at how these memories are filed in the places below. Your job is how the memory is kept, never what the person should do in a project.",
  suggests: "one tidy-up of how memories are filed: a note under the wrong place moved where it belongs, two notes about the same thing linked so each shows the other, a topic that has grown into two given its own place, or a place renamed to what the person calls it.",
  ask: '"looked": "one short line on what you checked"',
  handle(ctx, entries, reply, notePath, suggestion) {
    ctx.writeNote(`${ctx.today}.md`, personaNote("topic-gardener", "Topic gardener", ctx.today, entries.length,
      suggestion ? suggestionLines(suggestion, "Proposed: ") : [`- Nothing needs tidying.${str(reply?.looked) ? ` ${str(reply?.looked)}` : ""}`]));
    if (!suggestion) return `Read ${entries.length} memories, nothing to tidy`;
    postSuggestionCard(ctx, entries, suggestion, { label: "Its notes", path: notePath });
    return `Read ${entries.length} memories and suggested one tidy-up`;
  },
});

export const IDEAS_DIGEST: PersonaDefinition = modelPersona({
  id: "ideas-digest",
  name: "Ideas digest",
  purpose: "Collects the ideas you had into one digest and links the ones that belong together.",
  brief: "Once a week it reads what you said in the last 14 days and gathers your ideas into one digest in its own folder. It suggests linking two notes of the same idea, or giving an idea you keep coming back to its own place, or posts the one you came back to most. It never turns an idea into project work.",
  skills: ["read", "write-own-folder", "post-inbox", "propose-desk-job"],
  schedule: { every: "week" },
  days: 14,
  system: "Collect the ideas the person had: what-ifs, things to try, make or explore. Not tasks, facts or a project's next steps.",
  suggests: "link two memories of the same idea so each shows the other, or give an idea they came back to several times, which already has a page, its own place at the top of the tree.",
  ask: '"ideas": [{"title": "one short line", "sources": [numbers]}] with at most 8 ideas, the one they came back to most first, or an empty list',
  handle(ctx, entries, reply, notePath, suggestion) {
    const ideas = list(reply?.ideas).map((idea) => ({ title: str(idea.title), sources: nums(idea.sources) })).filter((idea) => idea.title && !isProjectWork(idea.title)).slice(0, 8);
    ctx.writeNote(`${ctx.today}.md`, personaNote("ideas-digest", "Ideas digest", ctx.today, entries.length, [...(ideas.length ? ideas.map((idea) => `- ${idea.title}`) : ["- No ideas this time."]), ...suggestionNote(suggestion)]));
    if (suggestion) {
      postSuggestionCard(ctx, entries, suggestion, { label: "The digest", path: notePath });
      return `Read ${entries.length} memories, collected ${ideas.length} ideas and suggested one change`;
    }
    const top = ideas[0];
    if (!top) return `Read ${entries.length} memories, no ideas`;
    ctx.postFinding({ title: `${ideas.length} ideas this fortnight. Most on your mind: ${top.title}`, links: [...sourceLinks(entries, top.sources), { label: "The digest", path: notePath }] });
    return `Read ${entries.length} memories and collected ${ideas.length} ideas`;
  },
});

const TRY_DAYS = 3;
/** How many of its own earlier days it reads back, so it never offers the same thing twice in a row. */
const TRY_LOOK_BACK = 5;

/**
 * S38: the one thing to try from its reply, or null. S36: with what it came from and the thing in a few
 * words, and why they might skip it, it also carries the helpers' card: the picture, why yes, why not.
 */
export function parseThingToTry(reply: Record<string, unknown> | null): { title: string; why: string; sources: number[]; card: HelperCard | null } | null {
  const raw = reply?.try && typeof reply.try === "object" ? (reply.try as Record<string, unknown>) : null;
  const title = str(raw?.title);
  if (!title) return null;
  const why = str(raw?.why, 500);
  const card = cleanHelperCard({ picture: { change: "try", from: raw?.topic, to: raw?.short }, yes: why, no: raw?.whyNot });
  return { title, why, sources: nums(raw?.sources), card };
}

const TRY_SYSTEM = [
  "You are Something to try, a quiet helper that reads what a person has been talking about in their own notes, mostly their voice notes, once a day.",
  "Pick the one thing they have been talking about most in these notes, and suggest ONE small, concrete thing they could try in the next day or two because of it: an experiment, a habit, a way to think about it, a conversation to have, a tool, a place, a book.",
  "Tie it plainly to what they said, so they see where it comes from. Be gentle: an idea to try, never a claim that it solves anything.",
  "You are not a project manager. Never suggest a task, a ticket, a release, a deploy, or work for a team or an agent. A project can be what they talk about; the thing to try is for the person.",
  "Use only what the notes say. Never invent facts, names or dates. Plain words a friend would use.",
  HELPER_CARD_WORDS,
].join(" ");

/**
 * S38 (Jordi, 2026-11-10: "a guy that gives me suggestions for things to try... maybe it's like once
 * a day, and it's about something that I've been leaving voice notes about"): once a day it reads the
 * last 3 days of what the person said, voice notes first, and posts one thing to try with the notes it
 * came from. One cheap model call a day; off until switched on.
 */
export const SOMETHING_TO_TRY: PersonaDefinition = {
  id: "something-to-try",
  name: "Something to try",
  purpose: "One small thing to try each day, drawn from what you have been talking about.",
  brief: "Once a day it reads what you said in the last 3 days, your voice notes first, and posts one small thing you could try because of it, with the notes it comes from. It never gives you project work.",
  schedule: { every: "night" },
  skills: ["read", "write-own-folder", "post-inbox"],
  defaultEnabled: false,
  // One cheap call a day, plus reading its own last few days back.
  limits: { maxSteps: 12, maxRunUsd: 0.02, maxMonthUsd: 0.1 },

  async fingerprint(ctx) {
    const entries = await ctx.recentMemories({ days: TRY_DAYS, limit: RECAP_MAX_MEMORIES });
    return entries.length ? `${entries.length}:${entries[0]!.evidenceRef}` : null;
  },

  async run(ctx) {
    const all = await ctx.recentMemories({ days: TRY_DAYS, limit: RECAP_MAX_MEMORIES });
    const voice = all.filter((entry) => entry.contentType === "voice_note" || entry.contentType === "audio" || /^(Voice note|Audio) "/.test(entry.title));
    const entries = voice.length >= 2 ? voice : all;
    if (!entries.length) return { summary: "Nothing said in the last 3 days, nothing to try" };
    // What it offered on its last days, so it does not repeat itself.
    const earlier: string[] = [];
    const today = Date.parse(`${ctx.today}T00:00:00Z`);
    for (let back = 1; back <= TRY_LOOK_BACK; back += 1) {
      const day = new Date(today - back * 24 * 3_600_000).toISOString().slice(0, 10);
      try {
        const note = await ctx.read(`Personas/something-to-try/${day}.md`);
        const line = /^## Try\n\n(.+)$/m.exec(note.body);
        if (line) earlier.push(line[1]!.trim());
      } catch {
        // no note that day
      }
    }
    const prompt = [
      `These are the notes the person saved in the last ${TRY_DAYS} days, newest first:`,
      "",
      ...memoryLines(entries),
      ...(earlier.length ? ["", "What you suggested on earlier days. Suggest something different:", ...earlier.map((line) => `- ${line}`)] : []),
      "",
      'Reply with JSON only: {"try": {"title": "the thing to try, one sentence that starts with a verb", "short": "the thing to try in at most 6 words", "topic": "what they keep talking about, in at most 6 of their own words", "why": "one or two sentences on what they said that it comes from", "whyNot": "one honest sentence on why they might skip it", "sources": [numbers]}} or {"try": null} when nothing they said calls for it',
    ].join("\n");
    const parsed = parseThingToTry(parseJsonReply(await ctx.think({ system: TRY_SYSTEM, prompt })));
    // S36: the card names notes the way the person knows them, never by the model's numbers.
    const said = memoryPhrases(entries);
    const raw = parsed ? { ...parsed, why: namedMemories(parsed.why, said), card: parsed.card ? namedCard(parsed.card, said) : null } : null;
    const leftOut = raw !== null && isProjectWork(raw.title);
    const thing = leftOut ? null : raw;
    const sources = (thing?.sources ?? []).map((n) => entries[n - 1]).filter((entry): entry is MemoryEntry => entry !== undefined);
    ctx.writeNote(`${ctx.today}.md`, personaNote("something-to-try", "Something to try", ctx.today, entries.length, thing
      ? ["## Try", "", thing.title, "", ...(thing.why ? [thing.why, ""] : []), ...(thing.card?.no ? [`Why not: ${thing.card.no}`, ""] : []), ...(sources.length ? ["## From", "", ...sources.map((entry) => `- [[${entry.evidenceRef.replace(/\.md(?=#)/, "")}|${memoryTitle(entry)} ${entry.capturedAt.slice(0, 10)}]]`)] : [])]
      : [leftOut ? "- Nothing to try today: the idea was project work, left out." : "- Nothing to try today."]));
    if (!thing) return { summary: `Read ${entries.length} notes, nothing to try${leftOut ? "; left out one idea about project work" : ""}` };
    ctx.postFinding({
      title: thing.title,
      // S36: with a card its why sits on the card as why yes, beside why not.
      ...(thing.why && !thing.card ? { body: thing.why } : {}),
      links: [...sourceLinks(entries, thing.sources), { label: "Its notes", path: `Personas/something-to-try/${ctx.today}.md` }],
      ...(thing.card ? { card: thing.card } : {}),
    });
    return { summary: `Read ${entries.length} notes and posted one thing to try` };
  },
};

const HEALTH_DAYS = 28;
/** S27: from this many pages under no place, Health suggests filing them. */
const HEALTH_LOOSE_PAGES = 3;
/** The pages named in that suggestion: the rest come in a later week. */
const HEALTH_LOOSE_NAMED = 6;

/** No model: counts only. Tells you when capture has gone quiet or many memories are nearly empty. */
export const MEMORY_HEALTH: PersonaDefinition = {
  id: "memory-health",
  name: "Health of your memory",
  purpose: "Tells you when saving has gone quiet, memories are nearly empty or pages have no place.",
  brief: "Once a week it counts what you said in the last 4 weeks and the pages that are under no place, with no AI call and no cost, writes the numbers in its own folder and posts only when something stands out. It suggests filing the loose pages.",
  schedule: { every: "week" },
  skills: ["read", "write-own-folder", "post-inbox", "propose-desk-job"],
  defaultEnabled: false,
  limits: { maxSteps: 6, maxRunUsd: 0.001, maxMonthUsd: 0.001 },
  revisedAt: SUGGESTS_SINCE,

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
    const places = await ctx.places();
    const loose = places?.unplaced ?? 0;
    ctx.writeNote(`${ctx.today}.md`, personaNote("memory-health", "Health of your memory", ctx.today, entries.length, [
      `- Saved this week: ${perWeek[0]}, the three weeks before: ${perWeek[1]}, ${perWeek[2]}, ${perWeek[3]}`,
      `- Days with something saved this week: ${days} of 7`,
      `- Nearly empty memories, under 5 words: ${thin} of ${entries.length}`,
      ...(places ? [`- Pages under no place in the tree: ${loose}`] : []),
    ]));
    const numbers = { label: "The numbers", path: `Personas/memory-health/${ctx.today}.md` };
    // S27: loose pages are one change the desk can make, so they come first, as a suggestion.
    if (loose >= HEALTH_LOOSE_PAGES && places && places.loose.length) {
      ctx.postSuggestion({
        title: loose > HEALTH_LOOSE_NAMED ? `${loose} pages in your memory are not under any place yet. Here are ${HEALTH_LOOSE_NAMED} to file.` : `${loose} pages in your memory are not under any place yet.`,
        action: `Move these pages, which are under no place in the tree yet, each under the place it belongs to: ${places.loose.slice(0, HEALTH_LOOSE_NAMED).map((title) => `"${title.slice(0, 60)}"`).join(", ")}.`,
        links: [numbers],
        card: {
          picture: null,
          yes: "A page with no place is harder to find in the tree and in answers.",
          no: "The memory desk picks each page's place itself, so one may land somewhere you would not put it. Undo puts it back.",
        },
      });
      return { summary: `Counted ${entries.length} memories and ${loose} loose pages, suggested filing them` };
    }
    const before = (perWeek[1]! + perWeek[2]! + perWeek[3]!) / 3;
    const quiet = before >= 3 && perWeek[0]! < before / 2;
    const empty = entries.length >= 5 && thin / entries.length > 0.3;
    if (!quiet && !empty) return { summary: `Counted ${entries.length} memories, all looks normal` };
    ctx.postFinding({
      title: quiet
        ? `You saved ${perWeek[0]} memories this week, against about ${Math.round(before)} a week before.`
        : `${thin} of your last ${entries.length} memories are nearly empty.`,
      links: [numbers],
    });
    return { summary: `Counted ${entries.length} memories and posted one finding` };
  },
};

/** S37: asks one short question when a memory could mean two things; its answer is filed like a note. */
export const CLARIFIER: PersonaDefinition = createClarifier({ memoryOnly: MEMORY_ONLY, memoryTitle, memoryWords, parseJsonReply });

/** S41: one pattern in how the person thinks or works, and one idea research supports, every few days. */
export const PATTERNS_AND_IDEAS: PersonaDefinition = createPatterns({ memoryOnly: MEMORY_ONLY, memoryTitle, memoryWords, parseJsonReply, memoryPhrases });

/** Every persona the runner knows, in catalog order. Only Weekly recap is on by default. */
export const BUILT_IN_PERSONAS: readonly PersonaDefinition[] = [WEEKLY_RECAP, OPEN_LOOPS, PEOPLE_FOLLOW_UPS, TOPIC_GARDENER, IDEAS_DIGEST, SOMETHING_TO_TRY, PATTERNS_AND_IDEAS, MEMORY_HEALTH, CLARIFIER];

export function personaById(id: string): PersonaDefinition | null {
  return BUILT_IN_PERSONAS.find((persona) => persona.id === id) ?? null;
}
