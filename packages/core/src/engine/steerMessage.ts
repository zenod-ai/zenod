import type { TreeNode } from "../vault/tree.js";
import { MAX_ROOT_NAME, UNSAFE_NAME_RE } from "../vault/treeSteering.js";
import type { TreeSteerAction } from "./treeSteer.js";

/**
 * Steering by message (EPIC-9 E9-5e; E9-4 design §5 "How Jordi steers"). A short message such as
 * "pin Agent Team", "rename Housing to House", "Agentine is the agent team", "EpicSpine is not
 * Agent Team", "that's wrong" or "yes, close House" (English, Spanish or Catalan) is read before
 * normal filing, so it becomes a Keeper note or an undo and is never filed as a memory.
 *
 * This module is pure: it parses the message and plans the steer against the roots of Tree.md. The
 * engine applies the plan under the vault write lock (one commit) and replies with the text built here.
 * Anything it is unsure about is either a short clarifying question (a steering verb naming an unknown
 * or ambiguous root) or not a steer at all (an ordinary sentence that only looks like "X is Y").
 */

export type SteerLang = "en" | "es";

export type SteerIntent =
  | { kind: "pin"; root: string }
  | { kind: "rename"; root: string; name: string }
  /** "a is b": one side names a root, the other becomes its alias. `explicit` for "is the same as"/"means". */
  | { kind: "alias"; a: string; b: string; explicit: boolean }
  | { kind: "keep-apart"; a: string; b: string }
  /** `confirmed` when it answers a proposal ("yes, close X"). */
  | { kind: "close"; root: string; confirmed: boolean }
  /** `explicit` when it names the tree ("undo the last tree change"); a bare "that's wrong" needs a steer reply just before. */
  | { kind: "undo"; explicit: boolean };

export interface ParsedSteer {
  intent: SteerIntent;
  lang: SteerLang;
}

const MAX_STEER_CHARS = 120;
const MAX_TERM_WORDS = 6;
/** A plain "X is Y" only steers when both sides are this short. */
const MAX_PLAIN_ALIAS_WORDS = 4;

const COURTESY_LEAD = /^(?:(?:ok(?:ay)?|vale|val|please|pls|por\s+favor|si\s+us\s+plau|zenod|hey|oye|ei)[,:!]?\s+)+/iu;
const COURTESY_TAIL = /[,\s]+(?:please|pls|thanks|thank\s+you|por\s+favor|gracias|si\s+us\s+plau|gràcies|merci)$/iu;
const ARTICLE = /^(?:(?:the|a|an|el|la|lo|los|las|els|les|un|una)\s+|l['’]\s*)/iu;
const TOPIC_WORD = /^(?:(?:topic|root|tema|carpeta|branch|rama|branca)\s+)/iu;

/** Clean one side of a steer: quotes, articles and "topic" go; empty or too long gives null. */
function term(raw: string | undefined): string | null {
  if (!raw) return null;
  let t = raw.trim().replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/gu, "").trim();
  for (let i = 0; i < 2; i++) t = t.replace(ARTICLE, "").replace(TOPIC_WORD, "").trim();
  t = t.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/gu, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_ROOT_NAME || UNSAFE_NAME_RE.test(t) || t.split(" ").length > MAX_TERM_WORDS) return null;
  return t;
}

function clean(message: string): string | null {
  const text = message.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_STEER_CHARS || /[?¿]/.test(text)) return null;
  return text.replace(COURTESY_LEAD, "").replace(/[.!¡…]+$/u, "").replace(COURTESY_TAIL, "").replace(/[.!¡…]+$/u, "").trim() || null;
}


const UNDO_CLAUSES: Array<{ re: RegExp; lang: SteerLang; explicit?: boolean }> = [
  { re: /^(?:no\s+)?(?:that['’]?s|that\s+is|this\s+is|it['’]?s)\s+(?:wrong|not\s+right|incorrect)$/iu, lang: "en" },
  { re: /^(?:no\s+)?(?:wrong|not\s+right)$/iu, lang: "en" },
  { re: /^(?:undo|revert)\s+(?:the\s+)?(?:last\s+)?(?:tree|memory|keeper)\s+change$/iu, lang: "en", explicit: true },
  { re: /^(?:undo|revert)(?:\s+(?:that|it|this|the\s+last\s+change))?$/iu, lang: "en" },
  { re: /^(?:no\s+)?(?:eso\s+|esto\s+)?(?:está|esta)\s+mal$/iu, lang: "es" },
  { re: /^(?:no\s+)?(?:eso\s+|esto\s+)?no\s+es\s+(?:así|asi|correcto)$/iu, lang: "es" },
  { re: /^(?:deshaz|deshacer|revierte)\s+(?:el\s+)?(?:último\s+|ultimo\s+)?cambio\s+(?:del\s+árbol|del\s+arbol|de\s+(?:la\s+)?memoria)$/iu, lang: "es", explicit: true },
  { re: /^(?:deshaz(?:lo)?|deshacer|revierte(?:lo)?)(?:\s+(?:eso|esto|el\s+(?:último|ultimo)\s+cambio))?$/iu, lang: "es" },
  { re: /^(?:no\s+)?(?:això\s+)?(?:està|esta)\s+malament$/iu, lang: "es" },
  { re: /^(?:desfés|desfes|desfer)\s+(?:l['’]\s*)?(?:últim|ultim)\s+canvi\s+(?:de\s+l['’]\s*arbre|de\s+la\s+memòria|de\s+la\s+memoria)$/iu, lang: "es", explicit: true },
  { re: /^(?:desfés(?:-ho)?|desfes(?:-ho)?|desfer)(?:\s+(?:això|l['’]\s*(?:últim|ultim)\s+canvi))?$/iu, lang: "es" },
];

function parseUndo(text: string): ParsedSteer | null {
  const clauses = text.split(/\s*[,.;:!]\s*|\s+-\s+/u).map(c => c.trim()).filter(Boolean);
  if (!clauses.length || clauses.length > 3) return null;
  let lang: SteerLang | null = null;
  let explicit = false;
  for (const clause of clauses) {
    if (/^(?:no|nope)$/iu.test(clause)) continue;
    const hit = UNDO_CLAUSES.find(u => u.re.test(clause));
    if (!hit) return null;
    lang ??= hit.lang;
    explicit ||= hit.explicit === true;
  }
  return lang ? { intent: { kind: "undo", explicit }, lang } : null;
}

type Rule = { re: RegExp; lang: SteerLang; build: (m: RegExpExecArray) => SteerIntent | null };

const RULES: Rule[] = [
  // Rename: "rename X to Y", "X should be called Y"; "renombra X a Y", "cambia el nombre de X a Y"; "reanomena X a Y".
  { re: /^rename\s+(.+?)\s+(?:to|as|into)\s+(.+)$/iu, lang: "en", build: m => rename(m[1], m[2]) },
  { re: /^(.+?)\s+should\s+be\s+called\s+(.+)$/iu, lang: "en", build: m => rename(m[1], m[2]) },
  { re: /^(?:renombra(?:r)?|cambia(?:r)?\s+el\s+nombre\s+(?:de|a))\s+(.+?)\s+(?:a|como|por)\s+(.+)$/iu, lang: "es", build: m => rename(m[1], m[2]) },
  { re: /^(.+?)\s+(?:debería|deberia)\s+llamarse\s+(.+)$/iu, lang: "es", build: m => rename(m[1], m[2]) },
  { re: /^(?:reanomena(?:r)?|canvia(?:r)?\s+el\s+nom\s+(?:de|a))\s+(.+?)\s+(?:a|com|per)\s+(.+)$/iu, lang: "es", build: m => rename(m[1], m[2]) },
  // Pin: "pin X"; "fija X", "ancla X"; "fixa X".
  { re: /^pin\s+(.+)$/iu, lang: "en", build: m => one("pin", m[1]) },
  { re: /^(?:fija(?:r)?|ancla(?:r)?|fixa(?:r)?)\s+(.+)$/iu, lang: "es", build: m => one("pin", m[1]) },
  // Close: "(yes,) close X"; "(sí,) cierra X"; "(sí,) tanca X".
  { re: /^(?:(yes|yeah|yep|ok)[,!]?\s+)?close\s+(.+)$/iu, lang: "en", build: m => close(m[2], Boolean(m[1])) },
  { re: /^(?:(sí|si|vale|val|ok)[,!]?\s+)?(?:cierra(?:r)?|tanca(?:r)?)\s+(.+)$/iu, lang: "es", build: m => close(m[2], Boolean(m[1])) },
  // Keep apart: "X is not (part of) Y", "keep X and Y apart", "X and Y are different", "separate X from Y".
  { re: /^keep\s+(.+?)\s+(?:and|&)\s+(.+?)\s+(?:apart|separate)$/iu, lang: "en", build: m => apart(m[1], m[2]) },
  { re: /^keep\s+(.+?)\s+(?:apart|separate)\s+from\s+(.+)$/iu, lang: "en", build: m => apart(m[1], m[2]) },
  { re: /^separate\s+(.+?)\s+from\s+(.+)$/iu, lang: "en", build: m => apart(m[1], m[2]) },
  { re: /^(.+?)\s+(?:and|&)\s+(.+?)\s+are\s+(?:different|separate|not\s+the\s+same)(?:\s+(?:things|topics))?$/iu, lang: "en", build: m => apart(m[1], m[2]) },
  { re: /^(.+?)\s+(?:is\s+not|isn['’]t)\s+(?:part\s+of\s+|the\s+same\s+as\s+|under\s+|a\s+part\s+of\s+)?(.+)$/iu, lang: "en", build: m => apart(m[1], m[2]) },
  { re: /^(?:separa(?:r)?)\s+(.+?)\s+(?:de|del)\s+(.+)$/iu, lang: "es", build: m => apart(m[1], m[2]) },
  { re: /^(?:mantén|manten|mantener)\s+(.+?)\s+(?:y|e|i)\s+(.+?)\s+(?:separados|separadas|aparte|separats)$/iu, lang: "es", build: m => apart(m[1], m[2]) },
  { re: /^(.+?)\s+(?:y|e)\s+(.+?)\s+son\s+(?:distintos|distintas|diferentes|cosas\s+(?:distintas|diferentes))$/iu, lang: "es", build: m => apart(m[1], m[2]) },
  { re: /^(.+?)\s+i\s+(.+?)\s+són\s+(?:diferents|coses\s+diferents)$/iu, lang: "es", build: m => apart(m[1], m[2]) },
  { re: /^(.+?)\s+no\s+es\s+(?:parte\s+de\s+|lo\s+mismo\s+que\s+|igual\s+que\s+)?(.+)$/iu, lang: "es", build: m => apart(m[1], m[2]) },
  { re: /^(.+?)\s+no\s+és\s+(?:part\s+de\s+|el\s+mateix\s+que\s+)?(.+)$/iu, lang: "es", build: m => apart(m[1], m[2]) },
  // Alias, explicit: "X is the same as Y", "X means Y", "X is also called Y"; "X es lo mismo que Y", "X significa Y"; "X vol dir Y".
  { re: /^(.+?)\s+(?:is\s+the\s+same\s+as|is\s+another\s+name\s+for|is\s+also\s+(?:called|known\s+as)|means|=)\s+(.+)$/iu, lang: "en", build: m => alias(m[1], m[2], true) },
  { re: /^(.+?)\s+(?:es\s+lo\s+mismo\s+que|es\s+igual\s+que|es\s+otro\s+nombre\s+(?:de|para)|significa|también\s+se\s+llama|tambien\s+se\s+llama)\s+(.+)$/iu, lang: "es", build: m => alias(m[1], m[2], true) },
  { re: /^(.+?)\s+(?:és\s+el\s+mateix\s+que|vol\s+dir|també\s+es\s+diu)\s+(.+)$/iu, lang: "es", build: m => alias(m[1], m[2], true) },
  // Alias, plain: "X is Y"; "X es Y"; "X és Y" (only when Y is a root and X is not; see planSteer).
  { re: /^(.+?)\s+is\s+(.+)$/iu, lang: "en", build: m => alias(m[1], m[2], false) },
  { re: /^(.+?)\s+es\s+(.+)$/iu, lang: "es", build: m => alias(m[1], m[2], false) },
  { re: /^(.+?)\s+és\s+(.+)$/iu, lang: "es", build: m => alias(m[1], m[2], false) },
];

function rename(rawRoot?: string, rawName?: string): SteerIntent | null {
  const root = term(rawRoot);
  const name = rawName?.trim().replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/gu, "").replace(/\s+/g, " ").trim();
  return root && name ? { kind: "rename", root, name } : null;
}
function one(kind: "pin", raw?: string): SteerIntent | null {
  const root = term(raw);
  return root ? { kind, root } : null;
}
function close(raw: string | undefined, confirmed: boolean): SteerIntent | null {
  const root = term(raw);
  return root ? { kind: "close", root, confirmed } : null;
}
function apart(rawA?: string, rawB?: string): SteerIntent | null {
  const a = term(rawA);
  const b = term(rawB);
  return a && b && a.toLowerCase() !== b.toLowerCase() ? { kind: "keep-apart", a, b } : null;
}
function alias(rawA: string | undefined, rawB: string | undefined, explicit: boolean): SteerIntent | null {
  const a = term(rawA);
  const b = term(rawB);
  if (!a || !b || a.toLowerCase() === b.toLowerCase()) return null;
  if (!explicit && (a.split(" ").length > MAX_PLAIN_ALIAS_WORDS || b.split(" ").length > MAX_PLAIN_ALIAS_WORDS)) return null;
  return { kind: "alias", a, b, explicit };
}

/** Parse a message as a steer, or null when it does not have a steer's shape. */
export function parseSteerMessage(message: string): ParsedSteer | null {
  if (message.includes("\n")) return null;
  const text = clean(message);
  if (!text) return null;
  const undo = parseUndo(text);
  if (undo) return undo;
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const intent = rule.build(m);
    if (!intent) continue;
    // Spanish and Catalan share the "es" replies (Jordi mixes both).
    return { intent, lang: rule.lang };
  }
  return null;
}

// ---- Resolution against the tree ----

export interface SteerRoot {
  node: TreeNode;
  /** Page path (resolved). */
  path: string;
  /** Other names: page aliases and Keeper-note alias groups. */
  aliases: string[];
}

/** Lower-case, accents off, `_`/`-`/quotes as spaces: "agent_team" and "Agent Team" compare equal. */
export function normName(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[_\-–—'’".,()]+/g, " ").replace(/\s+/g, " ").trim();
}

export type Resolution =
  | { kind: "one"; root: SteerRoot }
  | { kind: "many"; roots: SteerRoot[] }
  | { kind: "none" };

/**
 * A root by id, name or alias (exact, ignoring case and accents); else the roots whose name holds every
 * word of the term ("Alpha9" → "Alpha9 Tax and AEAT"). Several → ambiguous: the caller asks, never guesses.
 */
export function resolveRoot(raw: string, roots: readonly SteerRoot[]): Resolution {
  const want = normName(raw.replace(/^\^/, ""));
  if (!want) return { kind: "none" };
  const exact = roots.filter(r => r.node.id === raw.replace(/^\^/, "").trim()
    || normName(r.node.name) === want || r.aliases.some(a => normName(a) === want));
  if (exact.length === 1) return { kind: "one", root: exact[0]! };
  if (exact.length > 1) {
    const byName = exact.filter(r => normName(r.node.name) === want);
    return byName.length === 1 ? { kind: "one", root: byName[0]! } : { kind: "many", roots: exact };
  }
  const words = want.split(" ");
  const partial = roots.filter(r => [r.node.name, ...r.aliases].some(name => {
    const have = new Set(normName(name).split(" "));
    return words.every(w => have.has(w));
  }));
  if (partial.length === 1) return { kind: "one", root: partial[0]! };
  return partial.length ? { kind: "many", roots: partial } : { kind: "none" };
}

// ---- Planning ----

export interface SteerApply {
  action: TreeSteerAction;
  root: SteerRoot;
  name?: string;
  aliases?: string[];
  others?: SteerRoot[];
}

export type SteerPlan =
  | { type: "apply"; apply: SteerApply }
  | { type: "undo" }
  /** A short question back (unknown or ambiguous root, or a request this version cannot do). */
  | { type: "reply"; text: string }
  /** Not a steer after all: handle the message as usual. */
  | { type: "pass" };

/** Every steer reply starts with this, so a bare "that's wrong" right after one is read as an undo. */
export const STEER_REPLY_PREFIX: Record<SteerLang, string> = { en: "Memory tree: ", es: "Árbol de memoria: " };

export function isSteerReply(text: string): boolean {
  return Object.values(STEER_REPLY_PREFIX).some(prefix => text.startsWith(prefix));
}

/** A steer reply that reported a change (so a bare "that's wrong" after it means: undo that), not a question. */
export function isUndoableSteerReply(text: string): boolean {
  return isSteerReply(text) && [UNDO_HINT.en, UNDO_HINT.es, ...Object.values(AGAIN_HINT)].some(hint => text.includes(hint.trim()));
}

const say = (lang: SteerLang, en: string, es: string) => `${STEER_REPLY_PREFIX[lang]}${lang === "es" ? es : en}`;
const list = (roots: readonly SteerRoot[], lang: SteerLang) => {
  const names = roots.map(r => `"${r.node.name}"`);
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${lang === "es" ? "o" : "or"} ${names.at(-1)}`;
};
const topicNames = (roots: readonly SteerRoot[], kind: "working" | "long-term") =>
  roots.filter(r => r.node.kind === kind).map(r => r.node.name).join(", ");

function unknownRoot(name: string, roots: readonly SteerRoot[], lang: SteerLang): string {
  const working = topicNames(roots, "working");
  return say(lang,
    `I don't have a topic called "${name}". Which one did you mean?${working ? ` Your working topics: ${working}.` : ""}`,
    `no tengo ningún tema llamado "${name}". ¿Cuál querías decir?${working ? ` Tus temas activos: ${working}.` : ""}`);
}
function ambiguous(name: string, many: readonly SteerRoot[], lang: SteerLang): string {
  return say(lang, `"${name}" could be ${list(many, lang)}. Which one?`, `"${name}" puede ser ${list(many, lang)}. ¿Cuál?`);
}

/** Decide what a parsed steer does on this tree. Pure. */
export function planSteer(parsed: ParsedSteer, roots: readonly SteerRoot[]): SteerPlan {
  const { intent, lang } = parsed;
  if (intent.kind === "undo") return { type: "undo" };
  if (!roots.length) {
    // Steering verbs still deserve an answer; a plain "X is Y" on a vault without a tree is just a note.
    if (intent.kind === "alias" || intent.kind === "keep-apart" || (intent.kind === "close" && !intent.confirmed)) return { type: "pass" };
    return { type: "reply", text: say(lang, "your memory has no topics yet, so there is nothing to change. Keep capturing and Zenod will find them.", "tu memoria todavía no tiene temas, así que no hay nada que cambiar. Sigue guardando notas y Zenod los encontrará.") };
  }
  switch (intent.kind) {
    case "pin":
    case "rename": {
      const r = resolveRoot(intent.root, roots);
      if (r.kind === "none") return { type: "reply", text: unknownRoot(intent.root, roots, lang) };
      if (r.kind === "many") return { type: "reply", text: ambiguous(intent.root, r.roots, lang) };
      if (intent.kind === "pin") return { type: "apply", apply: { action: "pin", root: r.root } };
      return { type: "apply", apply: { action: "rename", root: r.root, name: intent.name } };
    }
    case "close": {
      const r = resolveRoot(intent.root, roots);
      // "close the window" is not about the tree; "yes, close X" answers the keeper, so it is.
      if (r.kind === "none") return intent.confirmed ? { type: "reply", text: unknownRoot(intent.root, roots, lang) } : { type: "pass" };
      if (r.kind === "many") return { type: "reply", text: ambiguous(intent.root, r.roots, lang) };
      return { type: "apply", apply: { action: "close", root: r.root } };
    }
    case "keep-apart": {
      const a = resolveRoot(intent.a, roots);
      const b = resolveRoot(intent.b, roots);
      // An ordinary sentence ("the trip is not cancelled") names no root on one side or both.
      if (a.kind === "none" || b.kind === "none") return { type: "pass" };
      if (a.kind === "many") return { type: "reply", text: ambiguous(intent.a, a.roots, lang) };
      if (b.kind === "many") return { type: "reply", text: ambiguous(intent.b, b.roots, lang) };
      if (a.root === b.root) {
        return { type: "reply", text: say(lang, `"${intent.a}" and "${intent.b}" are the same topic, "${a.root.node.name}". Which other topic should I keep it apart from?`, `"${intent.a}" y "${intent.b}" son el mismo tema, "${a.root.node.name}". ¿De qué otro tema lo separo?`) };
      }
      return { type: "apply", apply: { action: "keep-apart", root: a.root, others: [b.root] } };
    }
    case "alias": {
      const a = resolveRoot(intent.a, roots);
      const b = resolveRoot(intent.b, roots);
      // Plain "X is Y": only when Y is a root and X is not ("Agentine is the agent team"); "Zenod is great" is not a steer.
      if (!intent.explicit) {
        if (b.kind !== "one" || a.kind !== "none") return { type: "pass" };
        return { type: "apply", apply: { action: "alias", root: b.root, aliases: [intent.a] } };
      }
      if (a.kind === "one" && b.kind === "one") {
        if (a.root === b.root) return { type: "reply", text: say(lang, `"${intent.a}" and "${intent.b}" already point to the same topic, "${a.root.node.name}". Nothing to change.`, `"${intent.a}" y "${intent.b}" ya son el mismo tema, "${a.root.node.name}". No hay nada que cambiar.`) };
        return { type: "reply", text: say(lang, `"${a.root.node.name}" and "${b.root.node.name}" are two topics. I can't merge topics by message yet. I can rename one (say "rename ${a.root.node.name} to …") or keep them apart (say "${a.root.node.name} is not ${b.root.node.name}").`, `"${a.root.node.name}" y "${b.root.node.name}" son dos temas. Todavía no puedo fusionar temas por mensaje. Puedo renombrar uno (di "renombra ${a.root.node.name} a …") o mantenerlos separados (di "${a.root.node.name} no es ${b.root.node.name}").`) };
      }
      if (a.kind === "many") return { type: "reply", text: ambiguous(intent.a, a.roots, lang) };
      if (b.kind === "many") return { type: "reply", text: ambiguous(intent.b, b.roots, lang) };
      if (b.kind === "one") return { type: "apply", apply: { action: "alias", root: b.root, aliases: [intent.a] } };
      if (a.kind === "one") return { type: "apply", apply: { action: "alias", root: a.root, aliases: [intent.b] } };
      return { type: "reply", text: unknownRoot(intent.b, roots, lang) };
    }
  }
}

// ---- Replies ----

const UNDO_HINT: Record<SteerLang, string> = {
  en: ` To undo it, reply "that's wrong".`,
  es: ` Para deshacerlo, responde "eso está mal".`,
};

/** The reply after a steer was written: what changed, in plain words, and how to undo it. */
export function steerAppliedReply(apply: SteerApply, note: string, lang: SteerLang): string {
  const name = apply.root.node.name;
  const hint = UNDO_HINT[lang];
  switch (apply.action) {
    case "pin":
      if (apply.root.node.kind === "long-term") {
        return say(lang, `pinned "${name}". It keeps this name and stays a topic of its own; it is in long-term memory now and moves up when you capture about it again (note ${note}).${hint}`,
          `he fijado "${name}". Mantiene este nombre y sigue siendo un tema propio; ahora está en la memoria a largo plazo y sube cuando vuelvas a hablar de ello (nota ${note}).${hint}`);
      }
      return say(lang, `pinned "${name}". It stays in working memory with this name, even when you go quiet on it (note ${note}).${hint}`,
        `he fijado "${name}". Se queda en la memoria activa con este nombre aunque no hables de ello (nota ${note}).${hint}`);
    case "rename":
      return say(lang, `renamed "${name}" to "${apply.name}". Zenod keeps your name from now on (note ${note}).${hint}`,
        `he renombrado "${name}" a "${apply.name}". Zenod mantendrá tu nombre a partir de ahora (nota ${note}).${hint}`);
    case "alias":
      return say(lang, `"${apply.aliases!.join('", "')}" now means "${name}". Search and the weekly tidy treat them as one (note ${note}).${hint}`,
        `"${apply.aliases!.join('", "')}" ahora quiere decir "${name}". La búsqueda y el orden semanal los tratan como uno (nota ${note}).${hint}`);
    case "keep-apart": {
      const others = apply.others!.map(o => `"${o.node.name}"`).join(", ");
      return say(lang, `"${name}" and ${others} stay separate topics. Zenod will never merge them (note ${note}).${hint}`,
        `"${name}" y ${others} seguirán siendo temas separados. Zenod nunca los fusionará (nota ${note}).${hint}`);
    }
    case "close":
      return say(lang, `closed "${name}". It moves to long-term memory at the next weekly tidy, with all its pages, and stays there until you pin it again (note ${note}).${hint}`,
        `he cerrado "${name}". Pasa a la memoria a largo plazo en el próximo orden semanal, con todas sus páginas, y se queda allí hasta que lo vuelvas a fijar (nota ${note}).${hint}`);
  }
}

/** The reply when the steer was already in force. */
export function steerUnchangedReply(apply: SteerApply, lang: SteerLang): string {
  const name = apply.root.node.name;
  switch (apply.action) {
    case "pin": return say(lang, `"${name}" is already pinned. Nothing changed.`, `"${name}" ya está fijado. No he cambiado nada.`);
    case "rename": return say(lang, `the topic is already called "${name}". Nothing changed.`, `el tema ya se llama "${name}". No he cambiado nada.`);
    case "alias": return say(lang, `"${apply.aliases!.join('", "')}" already means "${name}". Nothing changed.`, `"${apply.aliases!.join('", "')}" ya quiere decir "${name}". No he cambiado nada.`);
    case "keep-apart": return say(lang, `those topics are already kept apart. Nothing changed.`, `esos temas ya están separados. No he cambiado nada.`);
    case "close": return say(lang, `"${name}" is already closed. Nothing changed.`, `"${name}" ya está cerrado. No he cambiado nada.`);
  }
}

const AGAIN_HINT: Record<SteerLang, string> = {
  en: `Say "that's wrong" again`,
  es: `Di "eso está mal" otra vez`,
};

/** The reply after an undo (or a redo, when the commit reverted was itself an undo). `what` is the change in words ("pin Agent Team"). */
export function undoReply(what: string, commit: string, lang: SteerLang, redo = false): string {
  if (redo) {
    return say(lang, `put back: ${what}. I reverted the undo (${commit}) with a new commit; nothing was deleted. ${AGAIN_HINT.en} to undo it.`,
      `recuperado: ${what}. He revertido el deshacer (${commit}) con un commit nuevo; no se ha borrado nada. ${AGAIN_HINT.es} para deshacerlo.`);
  }
  return say(lang, `undone: ${what}. I reverted that one change (${commit}) with a new commit; nothing was deleted. ${AGAIN_HINT.en} to put it back.`,
    `deshecho: ${what}. He revertido ese cambio (${commit}) con un commit nuevo; no se ha borrado nada. ${AGAIN_HINT.es} para recuperarlo.`);
}

export function nothingToUndoReply(lang: SteerLang): string {
  return say(lang, `there is no recent change to your memory tree to undo. Nothing changed.`, `no hay ningún cambio reciente en tu árbol de memoria que deshacer. No he cambiado nada.`);
}

export function steerFailedReply(lang: SteerLang, reason: "busy" | "conflict" | "unsupported" | "invalid_name" | "name_taken" | "error", detail = ""): string {
  switch (reason) {
    case "invalid_name": return say(lang, `that name can't be used: a topic name is 1–${MAX_ROOT_NAME} characters without | ^ [ ] #. Nothing changed.`, `ese nombre no sirve: un tema tiene 1–${MAX_ROOT_NAME} caracteres sin | ^ [ ] #. No he cambiado nada.`);
    case "name_taken": return say(lang, `another topic is already called "${detail}". Nothing changed.`, `ya hay otro tema que se llama "${detail}". No he cambiado nada.`);
    case "conflict": return say(lang, `that change can't be undone cleanly because later changes touched the same lines. Nothing changed.`, `ese cambio no se puede deshacer limpiamente porque cambios posteriores tocaron las mismas líneas. No he cambiado nada.`);
    case "unsupported": return say(lang, `undo by message needs a Git vault; this vault can't do it. Nothing changed.`, `deshacer por mensaje necesita un vault de Git; este vault no puede. No he cambiado nada.`);
    case "busy": return say(lang, `your memory is busy saving something else. Nothing changed; please send that again in a minute.`, `tu memoria está ocupada guardando otra cosa. No he cambiado nada; vuelve a enviarlo en un minuto.`);
    case "error": return say(lang, `I couldn't make that change just now. Nothing changed; please send it again in a minute.`, `no he podido hacer ese cambio ahora. No he cambiado nada; vuelve a enviarlo en un minuto.`);
  }
}

/**
 * What reverting a keeper commit means. Undo and redo alternate on the same original change, so
 * subjects never nest: reverting "memory: keeper note K-4 (pin X)" gives "memory: undo <sha> (keeper
 * note K-4 (pin X))"; reverting that gives "memory: redo <sha> (keeper note K-4 (pin X))", and so on.
 */
export function revertOf(subject: string, sha7: string): { subject: string; redo: boolean; what: string } {
  const toggle = /^memory: (undo|redo) [0-9a-f]+ \((.+)\)$/.exec(subject);
  const original = toggle ? toggle[2]! : subject.replace(/^memory:\s*/, "");
  const redo = toggle?.[1] === "undo";
  return { subject: `memory: ${redo ? "redo" : "undo"} ${sha7} (${original})`, redo, what: changeInWords(original) };
}

/** "keeper note K-4 (pin Agent Team)" → "pin Agent Team"; anything else as it is. */
export function changeInWords(original: string): string {
  const inner = /^(?:memory: )?keeper note K-\d+ \((.+)\)$/.exec(original);
  return inner ? inner[1]! : original.replace(/^memory:\s*/, "");
}

/** Vault commits "that's wrong" may undo: Keeper notes and steers, the weekly tidy, the keeper, and undos. */
export const KEEPER_COMMIT_RE = /^memory: (?:keeper\b|weekly tree sweep\b|tree\b|undo\b|redo\b)/;
