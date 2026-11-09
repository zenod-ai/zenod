// The web app's one Send button (EPIC-16 E16-B1): Zenod decides from a message's content whether it
// carries new information to keep, a question to answer from memory, or both. No imports, no I/O:
// the prompt, the parse, the rules and the guard are plain functions the engine, server and tests share.
// The guard is the promise the button makes: a question is never kept as a memory.

export type SendAction = "keep" | "answer" | "both" | "job" | "unsure" | "talk";

export interface SendRoute {
  action: SendAction;
  /** The new information to file, in the person's words; null when nothing is kept. */
  keep: string | null;
  /** The question to answer from memory; null when nothing is asked. */
  question: string | null;
  /**
   * EPIC-14 S3, the memory desk: a job on the memory itself (split, join, move, rename, relink,
   * "this is filed wrong"), in the person's words. Set for "job" (the model and the rules agree:
   * the desk runs it) and "unsure" (only one of them thinks so: the app asks "keep this, or do it as
   * a job?" and never runs a job on a guess). Nothing is kept or answered then.
   */
  job?: string | null;
  /**
   * EPIC-22 E22-2, Talk it over: the person wants to think something through with a persona that
   * reads their memory (an opinion, a pattern, a decision), in their words. Read-only: nothing is
   * kept or answered as a fact. Web app only; the WhatsApp and Telegram paths never use it (root L-6).
   */
  talk?: string | null;
  /** "model" when the chat model decided, "rules" when the plain rules did (no model, or it slipped). */
  by: "model" | "rules";
}

export interface SendRoutePrompt {
  system: string;
  prompt: string;
}

const SYSTEM = [
  "You sort one message a person sent to their personal memory app. The app can KEEP new information in their memory, ANSWER a question from their memory, or both.",
  "Reply with one line of JSON and nothing else: {\"keep\": \"...\", \"ask\": \"...\"}",
  "- keep: the new information the person is telling the app (a fact, event, decision, idea, plan, feeling or something to remember or be reminded of), copied in their own words. Drop lead-ins like \"remember that\", \"note:\", \"keep this:\". Use \"\" when the message tells nothing new.",
  "- ask: what the person wants to know or find in their memory, as a question in their own words. Requests like \"tell me\", \"show me\", \"remind me what\", \"what did I say about\", \"list\", \"find\", \"summarise\" are asks. Use \"\" when nothing is asked.",
  "- A question is never keep. \"Remind me to ...\" and \"don't forget ...\" are keep. Greetings and thanks are neither.",
  "- A message can carry both, like \"Remember Ana's birthday is May 3, and what did I say about the shed?\" -> {\"keep\": \"Ana's birthday is May 3\", \"ask\": \"what did I say about the shed?\"}",
  "- Answer in the message's own language; never add facts.",
  "- job: only when the person asks the app to reorganise their memory itself: split, untangle, join, merge, move or re-file topics, pages or notes, rename or relink them, clean up the tree, or says something is filed wrong. Copy the request in their words; then keep and ask are \"\". Use \"\" for anything else: moving furniture or renaming a company is news to keep, not a job.",
  "Reply shape when it is a job: {\"keep\": \"\", \"ask\": \"\", \"job\": \"...\"}",
  "- talk: only when the person wants to think something through WITH the app, using their memory: asks for its opinion or advice (\"what do you think\", \"should I\"), a pattern it sees, or says \"let's talk about\". Copy it in their words; then keep and ask are \"\". A question about what they themselves said, thought or felt before (\"what did I think about ...\") is ask, not talk.",
  "Reply shape when it is a talk: {\"keep\": \"\", \"ask\": \"\", \"talk\": \"...\"}",
].join("\n");

const JOB_VERB = /^(?:(?:can you|could you|please|pls|zenod,?)\s+)*(?:split|untangle|separate|disentangle|merge|join|combine|move|re-?file|refile|put|rename|re-?link|relink|link|unlink|reorgani[sz]e|tidy(?: up)?|clean(?: up)?|sort(?: out)?|fix|group|nest|separa|separar|junta|juntar|une|unir|mueve|mover|renombra|renombrar|ordena|ordenar|reorganiza|limpia)(?![\p{L}\p{N}])/iu;
const JOB_OBJECT = /(?<![\p{L}\p{N}])(?:topics?|pages?|notes?|memor(?:y|ies)|tree|filing|filed|folders?|categor(?:y|ies)|branch(?:es)?|temas?|p[aá]ginas?|notas?|memoria|[aá]rbol)(?![\p{L}\p{N}])/iu;
const JOB_COMPLAINT = /(?<![\p{L}\p{N}])(?:are|is|got|get|have been|están|esta|está)\s+(?:all\s+)?(?:tangled|mixed(?: up)?|knotted|filed wrong|in the wrong (?:place|topic)|liados|mezclados|enredados)(?![\p{L}\p{N}])/iu;

/** The plain rules' reading of a desk job: a request to reorganise the memory, never a bare chore. */
export function looksLikeDeskJob(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > 600) return false;
  if (JOB_COMPLAINT.test(text)) return true;
  return text.split(/(?<=[.!?])\s+|\n+/).some((sentence) => {
    const clause = sentence.trim().replace(/^[¿¡"'“(]+/, "");
    return JOB_VERB.test(clause) && JOB_OBJECT.test(clause);
  });
}

/** The desk's outcome when the model and the rules disagree or only the rules decide: ask, never guess. */
function deskRoute(message: string, modelJob: string | null, by: SendRoute["by"]): SendRoute | null {
  const rules = looksLikeDeskJob(message);
  if (!modelJob && !rules) return null;
  const job = message.trim();
  return { action: modelJob && rules ? "job" : "unsure", keep: null, question: null, job, by };
}

const TALK_START = /^(?:let'?s|let us|can we|could we|shall we|i want to|i'd like to|i would like to|i need to|help me)\s+(?:talk|think|discuss|chat|reflect|go over|work through|figure out|make sense|brainstorm|unpack|decide)(?![\p{L}\p{N}])|^talk (?:me through|it over|with me)(?![\p{L}\p{N}])|^how (?:do|should|can|could) (?:we|i) (?:progress|move (?:this )?forward|proceed|go about|approach|tackle|handle|think about|decide)(?![\p{L}\p{N}])|^(?:what do you (?:think|make of|reckon|suggest|recommend)|what'?s your (?:take|view|opinion|advice)|how do you see|do you think i)(?![\p{L}\p{N}])|^(?:should i|shall i|would it be (?:wise|smart|better)|is it (?:wise|a good idea))(?![\p{L}\p{N}])|^(?:why do i (?:keep|always)|what patterns?|do you (?:see|notice) (?:a |any )?(?:pattern|anything))(?![\p{L}\p{N}])|^(?:hablemos|podemos hablar|quiero (?:hablar|pensar|reflexionar)|ay[uú]dame a (?:pensar|entender|decidir)|qu[eé] (?:opinas|piensas|me recomiendas)|deber[ií]a)(?![\p{L}\p{N}])/iu;

/**
 * The plain rules' reading of Talk it over (EPIC-22 E22-2): the person opens a conversation about
 * their memory (an opinion, advice, a pattern, "let's talk about"), not a fact to find or keep.
 */
export function looksLikeTalk(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > 2_000) return false;
  const first = text.split(/(?<=[.!?])\s+|\n+/)[0]!.trim().replace(/^[¿¡"'“(]+/, "").replace(/^(?:(?:ok|okay|so|hey|hi|zenod|well|hmm|vale|oye|bueno)[,!.]?\s+)+/iu, "");
  return TALK_START.test(first);
}

function talkRoute(message: string, by: SendRoute["by"]): SendRoute {
  return { action: "talk", keep: null, question: null, talk: message.trim(), by };
}

export function sendRoutePrompt(message: string): SendRoutePrompt {
  return { system: SYSTEM, prompt: `MESSAGE\n${message}` };
}

const WH_START = /^(?:what|which)\s+(?:[\p{L}\p{N}'-]+\s+){1,3}(?:did|do|does|is|are|was|were|has|have|can|should|will)\s+|^(?:what|when|where|who|whom|whose|which|how|why)\s+(?:is|are|was|were|do|does|did|can|could|should|will|would|have|has|had|am|many|much|long|often|else|about|time|day|kind|exactly)(?![\p{L}\p{N}])|^(?:what's|whats|who's|where's|when's|how's|why's)(?![\p{L}\p{N}])|^(?:qu[eé]|cu[aá]ndo|d[oó]nde|qui[eé]n|c[oó]mo|cu[aá]l|cu[aá]nto|por qu[eé])(?![\p{L}\p{N}])/iu;
const AUX_START = /^(?:(?:do|does|did|can|could|have|has|had|should|would|will)\s+(?:i|we|you|my|our|there|it|he|she|they|anyone)|(?:is|are|was|were|am)\s+(?:i|we|you|my|our|the|there|it|he|she|they|anyone))(?![\p{L}\p{N}])|^(?:tengo|hay|hice|dije)(?![\p{L}\p{N}])/iu;
const RECALL_START = /^(?:(?:can you |could you |please )?(?:tell me|show me|remind me (?:what|when|where|who|how|of|about)|list|find|search|look up|summari[sz]e|give me|recap|dime|mu[eé]strame|busca|recu[eé]rdame (?:qu[eé]|cu[aá]ndo|d[oó]nde|qui[eé]n)))(?![\p{L}\p{N}])/iu;
const KEEP_LEAD = /^(?:please\s+)?(?:remember(?:\s+that)?|note(?:\s+that)?|keep(?:\s+this)?|save(?:\s+this)?|store(?:\s+this)?|add(?:\s+this)?|for the record|fyi|recuerda(?:\s+que)?|apunta(?:\s+que)?|guarda(?:\s+que)?|nota)\s*[:,-]?\s+/iu;
const JOINED_QUESTION = /,?\s+(?:and|also|plus|but|y|pero|tambi[eé]n)\s+(?=(?:what|what's|when|where|who|which|how|why|do|did|does|is|are|can|could|tell me|show me|remind me what|qu[eé]|cu[aá]ndo|d[oó]nde|qui[eé]n|c[oó]mo|dime)(?![\p{L}\p{N}]))/iu;
const SMALL_TALK = /^(?:hi|hello|hey|hola|thanks|thank you|thx|gracias|ok|okay|vale|cool|great|bye|adi[oó]s|good (?:morning|night|evening))(?![\p{L}\p{N}])[\s!.?]*$/iu;

/** True when a clause asks for something rather than tells something. */
export function isQuestionClause(text: string): boolean {
  const clause = text.trim().replace(/^[¿¡"'“(]+/, "");
  if (!clause) return false;
  if (/\?\s*["')”]?$/.test(clause)) return true;
  if (/^have to(?![\p{L}\p{N}])|^has to(?![\p{L}\p{N}])/iu.test(clause)) return false;
  if (WH_START.test(clause)) return !/^(?:what a|how (?:nice|lovely|great|cool))(?![\p{L}\p{N}])/iu.test(clause);
  return AUX_START.test(clause) || RECALL_START.test(clause);
}

/** Sentences, then a question joined on by "and" or a comma ("paid the bill, when is it due?") as its own clause. */
function clauses(message: string): string[] {
  const sentences = message.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
  return sentences.flatMap((sentence) => {
    const out: string[] = [];
    for (const joined of sentence.split(JOINED_QUESTION).map((part) => part.trim()).filter(Boolean)) {
      const pieces = joined.split(/,\s+/);
      let current = pieces[0]!;
      for (const piece of pieces.slice(1)) {
        if (isQuestionClause(piece) && !/\?\s*$/.test(current)) {
          out.push(current);
          current = piece;
        } else current = `${current}, ${piece}`;
      }
      out.push(current);
    }
    return out;
  });
}

const stripLead = (text: string) => text.replace(KEEP_LEAD, "").trim();

/** A spoken tag, not a question: "you know?", "right?", "though?" (EPIC-22 E22-3, voice-style notes). */
const FILLER = /^(?:you know|y'?know|right|though|no|ok|okay|yeah|yes|eh|huh|man|bro|isn'?t it|don'?t you think|verdad|sabes|vale|no crees|¿?no)\s*[?!.]*$/iu;
/** A message this long is a note, told: a question inside it is rhetorical unless the note ends on it. */
const LONG_NOTE_CHARS = 600;
/** A request to someone at the end of a note ("can you dispatch somebody?") is part of the note, not a look-up. */
const REQUEST_START = /^(?:(?:so|and|but|also|then|y|pero)\s+)?(?:can|could|would|will) you(?![\p{L}\p{N}])|^(?:puedes|podr[ií]as)(?![\p{L}\p{N}])/iu;

/** The plain rules: each sentence is a question to answer or information to keep. */
export function ruleSendRoute(message: string): SendRoute {
  const text = message.trim();
  const desk = deskRoute(text, null, "rules");
  if (desk) return desk;
  if (looksLikeTalk(text)) return talkRoute(text, "rules");
  if (!text || SMALL_TALK.test(text)) return finish(null, text || null, "rules");
  const keep: string[] = [];
  const ask: string[] = [];
  const parts = clauses(text).filter((clause) => !FILLER.test(clause.replace(/^[¿¡"'“(]+/, "")));
  // EPIC-22 E22-3: a long note keeps every word; it is looked up only when it ends on a question.
  if (text.length > LONG_NOTE_CHARS) {
    const last = parts[parts.length - 1] ?? "";
    const ends = isQuestionClause(last) && !REQUEST_START.test(last.replace(/^[¿¡"'“(]+/, ""));
    return finish(stripLead(text), ends ? last : null, "rules");
  }
  for (const clause of parts) {
    const told = stripLead(clause);
    // A lead-in ("remember …") makes the clause information even when it reads like a question word.
    if (told !== clause && !/\?\s*$/.test(told)) keep.push(told);
    else if (isQuestionClause(clause)) ask.push(clause);
    else if (!SMALL_TALK.test(clause)) keep.push(clause);
  }
  return finish(keep.join(" ") || null, ask.join(" ") || null, "rules");
}

const words = (text: string) => (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/** A keep must come from the message itself: at least 80% of its words are the person's own. */
function grounded(keep: string, message: string): boolean {
  const own = new Set(words(message));
  const kept = words(keep);
  if (kept.length === 0) return false;
  return kept.filter((word) => own.has(word)).length / kept.length >= 0.8;
}

function finish(keep: string | null, question: string | null, by: SendRoute["by"]): SendRoute {
  const k = keep?.trim() || null;
  const q = question?.trim() || null;
  if (k && q) return { action: "both", keep: k, question: q, by };
  if (k) return { action: "keep", keep: k, question: null, by };
  return { action: "answer", keep: null, question: q, by };
}

/**
 * Read the model's JSON; null when it slipped (callers then use the rules). The guard holds either
 * way: a keep that reads as a question, or that is not in the person's own words, is not kept; a
 * message the rules read as only questions keeps nothing.
 */
export function parseSendRoute(output: string, message: string): SendRoute | null {
  const match = output.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let value: { keep?: unknown; ask?: unknown; job?: unknown; talk?: unknown };
  try {
    value = JSON.parse(match[0]) as { keep?: unknown; ask?: unknown; job?: unknown; talk?: unknown };
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const keep = typeof value.keep === "string" ? value.keep.trim() : "";
  const ask = typeof value.ask === "string" ? value.ask.trim() : "";
  const job = typeof value.job === "string" ? value.job.trim() : "";
  const talk = typeof value.talk === "string" ? value.talk.trim() : "";
  const desk = deskRoute(message, job || null, "model");
  if (desk) return desk;
  // The rules' talk stands; the model's talk only for a message that asks nothing ("I'm torn about the
  // flat"): a question ("what did I think about …", "what should people see first?") stays a look-up.
  if (looksLikeTalk(message) || (talk && !clauses(message.trim()).some(isQuestionClause))) return talkRoute(message, "model");
  return guardSendRoute(finish(keep || null, ask || null, "model"), message);
}

/** The promise of the one Send button: nothing that is only asked is ever kept. */
export function guardSendRoute(route: SendRoute, message: string): SendRoute {
  const text = message.trim();
  if (route.action === "job" || route.action === "unsure" || route.action === "talk") return route;
  const rules = ruleSendRoute(text);
  let keep = route.keep;
  let question = route.question;
  if (keep && (clauses(keep).some(isQuestionClause) || !grounded(keep, text))) keep = route.by === "model" ? rules.keep : null;
  // The rules find nothing to keep in a message that only asks: the model may not keep it either.
  if (keep && !rules.keep) keep = null;
  // A plain question mark the model overlooked is still answered.
  if (!question && rules.question && /\?/.test(rules.question)) question = rules.question;
  if (!keep && !question) question = text || null;
  return finish(keep, question, route.by);
}
