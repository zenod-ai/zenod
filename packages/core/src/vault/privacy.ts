import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNote } from "./frontmatter.js";
import { listMarkdownFiles, MEANING_FOLDERS } from "./files.js";
import { pagePathFromRef, pageTreeFields } from "./tree.js";

/**
 * Private memories (E15-S2): a page about the person's family, people, health or own money carries
 * `private: <kind>` in its frontmatter, decided when Zenod files it, with no model call. Retrieval
 * reads the flag (the app chat shows a private memory only on a strong match or when the answer cites
 * it); a Log entry is private when a page it was filed on is.
 *
 * The rule reads what the page says and where it sits, not its name: a kind's words must be at least
 * 3 and at least 2 % of the page's words, or the page's tree parent is private. Picked on Jordi's real
 * memory (evidence e15-s2): the 8 family, health and own-money pages, 5 by their words (29 to 55 per
 * thousand) and 3 short notes by place, under a private page; no other page reads over 18 per
 * thousand or has 3 such words at 16. The model's own tags marked 1 of the 8 and 15 business pages
 * "finance"; the name rule of E15-S1 took a company tax branch for private money. Business words
 * ("tax", "invoice", "accounting") are not money words here; the person's own money is (mortgage,
 * salary, savings, debt).
 *
 * The flag is only ever added. `private: false` written by the person keeps a page out for good.
 */
export const PRIVATE_KINDS = ["family", "health", "money", "people"] as const;
export type PrivateKind = (typeof PRIVATE_KINDS)[number];

/** A kind's words must be at least this many… */
export const PRIVATE_MIN_WORDS = 3;
/** …and at least this many per thousand words of the page. */
export const PRIVATE_PER_THOUSAND = 20;

const KIND_WORDS: Record<PrivateKind, RegExp> = {
  family: /\b(famil(?:y|ies|ia|iar|iares)|relatives?|parents?|mother|father|mum|mom|dad|grand(?:mother|father|ma|pa|parents?)|sisters?|brothers?|siblings?|sons?|daughters?|wife|husband|cousins?|uncle|aunt|nephew|niece|in-laws?|estrange\w*|divorce\w*|inheritance|madre|padres?|pap[aá]|mam[aá]|abuel[oa]s?|herman[oa]s?|hij[oa]s?|esposa|marido|prim[oa]s?|t[ií][oa]s?|sobrin[oa]s?|suegr[oa]s?|herencia|divorcio)\b/giu,
  health: /\b(health|healthy|doctors?|hospital|clinic|surgery|surgeon|transplant|diagnos\w*|medication|medicine|therap(?:y|ist)|illness|disease|symptoms?|treatment|dentist|prescription|injur(?:y|ies)|salud|m[eé]dic[oa]s?|cl[ií]nica|cirug[ií]a|cirujan[oa]|trasplante|diagn[oó]stico|medicaci[oó]n|medicamentos?|terapia|enfermedad|s[ií]ntomas?|tratamiento|dentista|receta|lesi[oó]n)\b/giu,
  money: /\b(mortgages?|salary|salaries|payslip|savings|debts?|loans?|net worth|pension|personal finances?|bank account|hipotecas?|salario|sueldo|n[oó]mina|ahorros|deudas?|pr[eé]stamos?|patrimonio|pensi[oó]n|cuenta bancaria|irpf)\b/giu,
  people: /\b(friends?|friendships?|girlfriend|boyfriend|dating|break-?up|ex-partner|amig[oa]s?|amistad|novi[oa]|pareja|ruptura)\b/giu,
};

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
// Citations, links and frontmatter-like markup are not the page's words.
const plain = (text: string) => text.replace(/\[\[[^\]]*\]\]/g, " ").replace(/\^[a-z]-[0-9a-f]{6,}/gi, " ");

/** The private kind a page's own words make it, or null (title, summary and body; no model call). */
export function privateKindOf(text: string): PrivateKind | null {
  const words = plain(text);
  const total = Math.max(1, wordCount(words));
  let best: { kind: PrivateKind; hits: number } | null = null;
  for (const kind of PRIVATE_KINDS) {
    const hits = words.match(KIND_WORDS[kind])?.length ?? 0;
    if (hits >= PRIVATE_MIN_WORDS && (hits * 1000) / total >= PRIVATE_PER_THOUSAND && (!best || hits > best.hits)) best = { kind, hits };
  }
  return best?.kind ?? null;
}

/** A page's recorded flag: its kind, `false` when the person opted it out, null when unflagged. */
export function recordedPrivacy(frontmatter: Record<string, unknown> | null): PrivateKind | false | null {
  if (!frontmatter || !("private" in frontmatter)) return null;
  const value = frontmatter.private;
  if (value === false || value === "false" || value === "no") return false;
  return typeof value === "string" && (PRIVATE_KINDS as readonly string[]).includes(value) ? (value as PrivateKind) : null;
}

/**
 * Filing (E15-S2): a meaning page gets `private: <kind>` added as one frontmatter line when its own
 * words make it private, or when it sits under a private page (its `parent:`, the place it was filed:
 * a short note under the family branch may say only "my father" twice). Nothing else in the file
 * changes. A page already flagged (or opted out) is left as it is, so a later filing never removes it.
 */
export function withPrivateFlag(path: string, raw: string, parentKind: PrivateKind | null = null): string {
  if (!(path.split("/")[0]! in MEANING_FOLDERS)) return raw;
  const { frontmatter, body } = parseNote(raw);
  if (!frontmatter || "private" in frontmatter) return raw;
  const kind = privateKindOf([frontmatter.title, frontmatter.summary, body].filter((part) => typeof part === "string").join("\n")) ?? parentKind;
  if (!kind) return raw;
  const close = raw.indexOf("\n---", 3);
  return `${raw.slice(0, close)}\nprivate: ${kind}${raw.slice(close)}`;
}

/** The recorded kind of a page's tree parent in the vault, or null (E15-S2). */
export async function parentPrivacy(vaultPath: string, raw: string): Promise<PrivateKind | null> {
  const parent = pageTreeFields(parseNote(raw).frontmatter).parent;
  if (!parent) return null;
  const parentPath = pagePathFromRef(parent);
  if (!parentPath || !(parentPath.split("/")[0]! in MEANING_FOLDERS)) return null;
  const parentRaw = await readFile(join(vaultPath, parentPath), "utf8").catch(() => null);
  return parentRaw === null ? null : recordedPrivacy(parseNote(parentRaw).frontmatter) || null;
}

/** withPrivateFlag with the page's parent read from the vault: what filing calls before it writes a page. */
export async function flagPrivatePage(vaultPath: string, path: string, raw: string): Promise<string> {
  if (!(path.split("/")[0]! in MEANING_FOLDERS)) return raw;
  return withPrivateFlag(path, raw, await parentPrivacy(vaultPath, raw));
}

/**
 * Back-fill (E15-S2): flag the vault's existing pages by the same rule, parents before children (a
 * page under a page flagged in this pass inherits it on the next). Adds one frontmatter line per
 * flagged page; text and place are untouched. `write: false` only reports.
 */
export async function backfillPrivateFlags(vaultPath: string, options: { write?: boolean } = {}): Promise<Array<{ path: string; kind: PrivateKind }>> {
  const pages = (await listMarkdownFiles(vaultPath)).filter((path) => path.split("/")[0]! in MEANING_FOLDERS);
  const raws = new Map<string, string>();
  for (const path of pages) raws.set(path, await readFile(join(vaultPath, path), "utf8"));
  const kindOf = (path: string) => recordedPrivacy(parseNote(raws.get(path) ?? "").frontmatter) || null;
  const flagged: Array<{ path: string; kind: PrivateKind }> = [];
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const path of pages) {
      const raw = raws.get(path)!;
      const parent = pageTreeFields(parseNote(raw).frontmatter).parent;
      const next = withPrivateFlag(path, raw, parent ? kindOf(pagePathFromRef(parent)) : null);
      if (next === raw) continue;
      raws.set(path, next);
      flagged.push({ path, kind: kindOf(path)! });
      changed = true;
    }
    if (!changed) break;
  }
  if (options.write) for (const { path } of flagged) await writeFile(join(vaultPath, path), raws.get(path)!);
  return flagged;
}
