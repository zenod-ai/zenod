import type { BrainLlm } from "zenod";

/**
 * E7-S1 round 2: a small memory question set run with real calls on the Anthropic route, for an
 * account without a vault (staging's test tenant). It files one note the way filing does (classify,
 * native structured output on the filing model) and asks three questions through the real answer loop
 * (the answer model, tools reading a three-note memory held here). Each answer passes when it carries
 * the expected facts, as in the memory test suite (scripts/memory-eval). Made-up notes only.
 */
const NOTES: Record<string, string> = {
  "Home/Spare key.md": "# Spare key\n\nThe spare house key is hidden under the stone frog next to the rosemary pot by the back door.",
  "Home/Wifi router.md": "# Wifi router\n\nWhen the wifi drops, unplug the router, wait 30 seconds, plug it back in. If that fails, hold the pin-hole reset button for 10 seconds.",
  "People/Ana.md": "# Ana\n\nAna's birthday is 14 March. She likes green tea and hates surprise parties.",
};

const QUESTIONS: Array<{ id: string; question: string; expect: string[][] }> = [
  { id: "key", question: "Where is the spare house key?", expect: [["frog"], ["rosemary"]] },
  { id: "router", question: "How do I fix the wifi when it drops?", expect: [["30"], ["10"]] },
  { id: "ana", question: "When is Ana's birthday and what does she like to drink?", expect: [["14", "fourteenth"], ["march"], ["tea"]] },
];

const NEW_NOTE = "Bought a new bike lock today, the combination is 4821. Keep it in the hallway drawer.";

const words = (text: string) => text.toLowerCase();

function tools() {
  const read: string[] = [];
  return {
    read,
    tools: {
      async searchVault(query: string) {
        const terms = words(query).split(/\W+/).filter((t) => t.length > 2);
        const hits = Object.entries(NOTES).filter(([path, body]) => terms.some((t) => words(path + " " + body).includes(t)));
        return hits.length ? hits.map(([path, body]) => `${path}: ${body.split("\n").filter(Boolean).slice(1).join(" ")}`).join("\n") : "No matches.";
      },
      async readNote(path: string) {
        const key = Object.keys(NOTES).find((p) => p === path || p === `${path}.md` || p.endsWith(`/${path}`) || p.endsWith(`/${path}.md`));
        if (!key) return `No note at ${path}.`;
        read.push(key);
        return NOTES[key]!;
      },
      async listPages() {
        return Object.keys(NOTES).join("\n");
      },
      async searchChats() {
        return "No past conversations.";
      },
    },
  };
}

export interface ProbeRow {
  id: string;
  job: "filing" | "answer";
  ok: boolean;
  ms: number;
  /** The first words of the reply (made-up notes only), or the error. */
  reply: string;
}

/** Run the set; `filing` and `answer` are the account's models for those jobs. Never throws. */
export async function runAnthropicQuestionSet(filing: BrainLlm, answer: BrainLlm): Promise<{ passed: number; total: number; rows: ProbeRow[] }> {
  const rows: ProbeRow[] = [];
  let started = Date.now();
  try {
    const result = await filing.classify({
      content: NEW_NOTE,
      hints: [],
      pageIndex: Object.entries(NOTES).map(([path, body]) => ({
        path,
        title: path.split("/").pop()!.replace(/\.md$/, ""),
        type: "page",
        tags: [path.split("/")[0]!.toLowerCase()],
        summary: body.split("\n").filter(Boolean).slice(1).join(" ").slice(0, 120),
      })) as never,
      tagVocabulary: ["home", "people"],
    });
    rows.push({ id: "file-note", job: "filing", ok: Boolean(result.summary?.trim()), ms: Date.now() - started, reply: String(result.summary ?? "").slice(0, 120) });
  } catch (error) {
    rows.push({ id: "file-note", job: "filing", ok: false, ms: Date.now() - started, reply: errorLine(error) });
  }
  for (const item of QUESTIONS) {
    started = Date.now();
    const { tools: readTools } = tools();
    try {
      const result = await answer.answer({ question: item.question, vaultBriefing: "A personal memory of short notes.", conversation: [] }, readTools);
      const text = words(result.text ?? "");
      const ok = item.expect.every((group) => group.some((w) => text.includes(w)));
      rows.push({ id: item.id, job: "answer", ok, ms: Date.now() - started, reply: (result.text ?? "").replace(/\s+/g, " ").slice(0, 160) });
    } catch (error) {
      rows.push({ id: item.id, job: "answer", ok: false, ms: Date.now() - started, reply: errorLine(error) });
    }
  }
  return { passed: rows.filter((r) => r.ok).length, total: rows.length, rows };
}

function errorLine(error: unknown): string {
  const e = error as { name?: string; message?: string; statusCode?: number; cause?: { message?: string } };
  return `${e?.name ?? "Error"}${e?.statusCode ? ` ${e.statusCode}` : ""}: ${String(e?.message ?? error).replace(/\s+/g, " ").slice(0, 200)}`;
}
