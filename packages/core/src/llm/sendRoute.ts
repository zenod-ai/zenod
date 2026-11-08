// The web app's one Send button (EPIC-16 E16-B1): Zenod decides from a message's content whether it
// carries new information to keep, a question to answer from memory, or both. No imports, no I/O:
// the prompt, the parse, the rules and the guard are plain functions the engine, server and tests share.
// The guard is the promise the button makes: a question is never kept as a memory.

export type SendAction = "keep" | "answer" | "both" | "job" | "unsure";

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

/** The plain rules: each sentence is a question to answer or information to keep. */
export function ruleSendRoute(message: string): SendRoute {
  const text = message.trim();
  const desk = deskRoute(text, null, "rules");
  if (desk) return desk;
  if (!text || SMALL_TALK.test(text)) return finish(null, text || null, "rules");
  const keep: string[] = [];
  const ask: string[] = [];
  for (const clause of clauses(text)) {
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
  let value: { keep?: unknown; ask?: unknown; job?: unknown };
  try {
    value = JSON.parse(match[0]) as { keep?: unknown; ask?: unknown; job?: unknown };
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const keep = typeof value.keep === "string" ? value.keep.trim() : "";
  const ask = typeof value.ask === "string" ? value.ask.trim() : "";
  const job = typeof value.job === "string" ? value.job.trim() : "";
  const desk = deskRoute(message, job || null, "model");
  if (desk) return desk;
  return guardSendRoute(finish(keep || null, ask || null, "model"), message);
}

/** The promise of the one Send button: nothing that is only asked is ever kept. */
export function guardSendRoute(route: SendRoute, message: string): SendRoute {
  const text = message.trim();
  if (route.action === "job" || route.action === "unsure") return route;
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
