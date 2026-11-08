// E15-Q2: a free, deterministic stand-in for Zenod's AI models, so the memory test suite runs on
// every change without spending model credit.
//
// classify   splits a note into sentences and sends each one to the candidate page whose title,
//            summary and tree place share the most rare words with it; with no good match it asks for
//            a new page. It sees exactly the candidate pages the code under test offers the real model,
//            so a change to which pages Zenod offers (or how it files the choice) moves the score.
// composePage writes the evidence onto the page with its citation and a link, like a careful model.
// streamMemoryChat records what the answer step was given (the memories it read) and answers
//            NO_ANSWER: the suite then checks whether the facts reached the answer step and counts tokens.
//
// It does not judge meaning the way a model does. The live-model tier (run.mjs --live) and the recorded
// live runs on the dashboard cover that.

const STOP = new Set(("the a an and or but of to in on at for with from by is are was were be been it its this that these those " +
  "i me my we our you your he she they them their his her there here what which who whom when where why how " +
  "about into over under after before again also just very much more most some any all each every no not " +
  "can could should would will shall may might must do does did done have has had having get got make made " +
  "now then than so too only one two three new old next last this week today tomorrow yesterday thing things " +
  "january february march april may june july august september october november december " +
  "monday tuesday wednesday thursday friday saturday sunday moved move said says need needs want got add " +
  "que lo la el los las de del y o en un una es por para con mas más o sea vale bueno").split(/\s+/));

export const words = (text) => String(text ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));

const stem = (w) => w.replace(/(ings?|ed|es|s)$/, "") || w;

export function sentences(text) {
  return String(text).split(/(?<=[.!?])\s+(?=[A-Z0-9¿¡"'])/).map((s) => s.trim()).filter(Boolean);
}

function titleFrom(sentence) {
  const picked = words(sentence).filter((w) => !/^\d+$/.test(w)).slice(0, 4);
  const t = picked.join(" ") || "Captured note";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Rare words weigh more: a word on every candidate page says little about where a sentence belongs. */
function scorer(pageIndex) {
  const docs = pageIndex.map((p) => {
    const bag = new Map();
    const add = (text, weight) => { for (const w of words(text)) bag.set(stem(w), Math.max(bag.get(stem(w)) ?? 0, weight)); };
    add(p.title, 3); add((p.aliases ?? []).join(" "), 3); add(p.summary, 1.5); add(p.place, 1); add(p.path.replace(/\//g, " "), 1);
    return { page: p, bag };
  });
  const df = new Map();
  for (const d of docs) for (const w of d.bag.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(1, docs.length);
  return (sentence) => {
    const ws = [...new Set(words(sentence).map(stem))];
    let best = null;
    for (const d of docs) {
      let s = 0;
      for (const w of ws) if (d.bag.has(w)) s += d.bag.get(w) * Math.log(1 + n / (df.get(w) ?? 1));
      // A leaf about the subject beats its branch head on a tie.
      if (s > 0 && d.page.path.split("/").length > 2) s *= 1.05;
      if (!best || s > best.score) best = { page: d.page, score: s };
    }
    return best;
  };
}

const MIN_SCORE = 6;

function today(now = new Date()) { return now.toISOString().slice(0, 10); }

export class StandInModel {
  constructor() { this.calls = { classify: 0, compose: 0, answer: 0 }; this.lastAnswerPrompt = null; }

  async classify(input) {
    this.calls.classify += 1;
    const pick = scorer((input.pageIndex ?? []).filter((p) => p.writable !== false));
    const rejected = new Set();
    for (const h of input.hints ?? []) if (/^Re-route:/.test(h)) for (const m of h.matchAll(/[\w ./&'-]+\.md/g)) rejected.add(m[0].trim());
    const topics = [];
    // A whole-note window when the code under test hands the model one (sourceRange); else the whole content.
    const body = input.sourceRange ? input.content.slice(input.sourceRange.start, input.sourceRange.end) : input.content;
    for (const sentence of sentences(body)) {
      if (words(sentence).length < 2) continue;
      const best = pick(sentence);
      const fits = best && best.score >= MIN_SCORE && !rejected.has(best.page.path);
      const page = fits
        ? { path: best.page.path, action: "update", title: best.page.title }
        : { path: `Notes/${titleFrom(sentence)}.md`, action: "create", title: titleFrom(sentence) };
      const last = topics.at(-1);
      if (last && last.pages[0].path === page.path) { last.evidenceQuotes.push(sentence); last.summary += ` ${sentence}`; continue; }
      topics.push({ topic: titleFrom(sentence), summary: sentence, evidenceQuotes: [sentence], confidence: 0.9,
        disposition: page.action === "update" ? "append_compact_note" : "integrate_page", pages: [page] });
    }
    const pages = [...new Map(topics.flatMap((t) => t.pages).map((p) => [p.path, p])).values()];
    return { confidence: 0.9, summary: topics.map((t) => t.topic).join("; ").slice(0, 120) || "note", tags: [], pages, topics,
      disposition: topics.some((t) => t.disposition === "integrate_page") ? "integrate_page" : "append_compact_note" };
  }

  async composePage(input) {
    this.calls.compose += 1;
    const link = (input.linkHints ?? [])[0] ?? "[[Index]]";
    const evidence = String(input.evidenceEntry ?? "").trim();
    const day = input.today ?? today();
    if (input.currentContent) {
      return `${input.currentContent.replace(/\s*$/, "")}\n\n## Update ${day}\n\n${evidence} ${input.citation}\n`;
    }
    const title = input.classification?.pages?.[0]?.title ?? input.path.split("/").pop().replace(/\.md$/, "");
    const summary = evidence.replace(/\s+/g, " ").replace(/"/g, "'").slice(0, 160);
    return `---\ntitle: ${title}\ntype: ${input.requiredType}\ntags: []\ncreated: ${day}\nupdated: ${day}\nsummary: "${summary}"\n---\n\n# ${title}\n\n${evidence} ${input.citation}\n\nSee ${link}.\n`;
  }

  async streamMemoryChat(input, onText) {
    this.calls.answer += 1;
    this.lastAnswerPrompt = String(input.prompt ?? "");
    this.lastAnswerTokens = Math.round((String(input.system ?? "").length + this.lastAnswerPrompt.length) / 4);
    onText?.("NO_ANSWER");
    return "NO_ANSWER";
  }

  async describeImage() { return ""; }
  async answer() { return { text: "I could not find that in your memory.", sources: [] }; }
  async work() { throw new Error("stand-in model: work loop not used by the memory suite"); }
  async extractBacklog() { return { candidates: [] }; }
}
