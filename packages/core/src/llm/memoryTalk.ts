// EPIC-22 E22-2, Talk it over: one turn of a read-only conversation between the person and a persona
// that reads their memory. No imports, no I/O: the prompt is a plain function the engine and tests share.
// The persona never keeps, files or changes anything; it talks from the memories it is given.

export interface TalkPersona {
  /** Shown as the speaker: "Weekly recap", "Open loops finder", or "Zenod" when no persona is named. */
  name: string;
  /** One plain line: what this persona looks for. */
  focus: string;
}

export interface TalkTurn {
  role: "person" | "persona";
  text: string;
}

export interface TalkMemory {
  n: number;
  title: string;
  /** Capture time and kind, when known ("2026-11-03 09:12 UTC, voice note"). */
  when?: string;
  text: string;
}

/** Earlier turns the model reads, newest last: enough for a conversation, never the whole history. */
export const TALK_HISTORY_TURNS = 8;
export const TALK_TURN_CHARS = 1_200;

export function memoryTalkPrompt(
  persona: TalkPersona,
  message: string,
  memories: readonly TalkMemory[],
  history: readonly TalkTurn[],
  today: string,
): { system: string; prompt: string } {
  const system = [
    `You are ${persona.name}, a helper inside Zenod, the librarian of a person's memory. ${persona.focus}`,
    "You are talking something over with the person, using only their own memories below.",
    "Talk like a thoughtful friend who has read their notes: warm, plain, short (two to five sentences). Point at what the memories show, cite them as [n], notice patterns or tensions, and end with one question that helps them think further.",
    "Never invent facts, names, dates or numbers. When the memories say nothing about it, say so plainly and ask what they think.",
    "You only read: never say you saved, kept, filed, moved or changed anything. No lists of advice, no headings.",
    "Answer in the language of the person's last message.",
  ].join(" ");
  const recent = history.slice(-TALK_HISTORY_TURNS).map((turn) =>
    `${turn.role === "person" ? "PERSON" : persona.name.toUpperCase()}: ${turn.text.slice(0, TALK_TURN_CHARS)}`);
  const prompt = [
    `TODAY ${today}`,
    "",
    "MEMORIES",
    ...(memories.length ? memories.map((memory) => `[${memory.n}] ${memory.title}${memory.when ? ` (${memory.when})` : ""}: ${memory.text}`) : ["(none match this yet)"]),
    "",
    ...(recent.length ? ["CONVERSATION SO FAR", ...recent, ""] : []),
    "PERSON",
    message,
  ].join("\n");
  return { system, prompt };
}

/** The memory numbers a reply cites, in order, each once. */
export function talkCitations(text: string): number[] {
  const seen: number[] = [];
  for (const match of text.matchAll(/\[(\d{1,2})\](?!\()/g)) {
    const n = Number(match[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}
