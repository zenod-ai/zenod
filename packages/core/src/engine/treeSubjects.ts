import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNote } from "../vault/frontmatter.js";
import { basenameOf, listMarkdownFiles } from "../vault/files.js";
import { CITATION_RE } from "../vault/pages.js";
import { outsideOpsRollup, readLogCaptures, type LogCapture } from "../vault/captureOrigin.js";
import { isTreePage, TREE_PARENT } from "../vault/tree.js";
import { tokens, type TrackedWrites } from "./treePlacement.js";
import { isFillerTerm, SUBJECT_GENERATOR } from "./treeDiscover.js";

export { SUBJECT_GENERATOR };

/**
 * Named subjects (EPIC-9 E9-2i; EPIC-9 L-1: roots come from content and freshness).
 *
 * Page clustering only finds subjects that already have pages. A product or project the
 * person keeps naming in their own captures, but that the librarian filed onto other
 * pages, never gets one: a name like `blue_heron` (spoken "blue heron") spread over other
 * pages, and as two common words ("blue", "heron") it could not set any page apart
 * either. So: the vault's coined names (written somewhere as one identifier,
 * `blue_heron`, `MossLantern`, `Tide-Cart`) are counted in the person's own recent
 * captures in any spelling ("blue heron", "Blue-Heron"); a name said often, on several
 * days, with no page titled after it, gets a page that cites those captures. Discovery
 * then treats it as a subject of its own. Agent reports never count (captureOrigin).
 *
 * Creates or appends to its own generated pages only; never moves or deletes a file,
 * never touches Log/ or _attachments/.
 */

export const SUBJECT_FIELD = "subject";
export const SUBJECT_DIR = "Projects";
/** Own captures counted: the working-memory window. */
export const SUBJECT_WINDOW_DAYS = 30;
/** A name is a subject when the person's own captures name it at least this often… */
export const SUBJECT_MIN_MENTIONS = 10;
/** …in at least this many captures… */
export const SUBJECT_MIN_CAPTURES = 3;
/** …on at least this many days. */
export const SUBJECT_MIN_DAYS = 2;
/** Each line on a subject page quotes this much around the first mention. */
const EXCERPT_CHARS = 160;

export interface NamedSubject {
  /** Letters and digits of the name, lowercase (`blueheron`). */
  key: string;
  /** How the person writes it, for the page title (`Blue Heron`). */
  display: string;
  /** Own captures in the window that name it, oldest first. */
  captures: Array<{ capture: LogCapture; mentions: number }>;
  mentions: number;
  days: number;
  /** The page already about it (title carries the name, or a subject page), when there is one. */
  page: string | null;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const keyOf = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Coined names: one identifier made of two or three words (`blue_heron`, `MossLantern`,
 * `Tide-Cart`). Lowercase kebab words (`long-term`, `follow-up`) are ordinary English and
 * file names; words with digits are ids, not names.
 */
const COINED_RES = [
  /(?<![\p{L}\p{N}_-])\p{L}{2,}(?:_\p{L}{2,}){1,2}(?![\p{L}\p{N}_-])/gu,
  /(?<![\p{L}\p{N}_-])\p{Lu}?\p{Ll}{2,}(?:\p{Lu}\p{Ll}{2,}){1,2}(?![\p{L}\p{N}_-])/gu,
  /(?<![\p{L}\p{N}_-])\p{Lu}\p{Ll}{1,}(?:-\p{Lu}\p{Ll}{1,}){1,2}(?![\p{L}\p{N}_-])/gu,
];

/** The words of a coined name: `blue_heron` → [blue, heron], `MossLantern` → [moss, lantern]. */
export function nameParts(name: string): string[] {
  return name.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").split(/[\s_-]+/).filter(Boolean).map(p => p.toLowerCase());
}

/** Coined names written anywhere in these texts, by key, with their written forms. */
export function coinedNames(texts: Iterable<string>): Map<string, { parts: string[]; forms: Map<string, number> }> {
  const out = new Map<string, { parts: string[]; forms: Map<string, number> }>();
  for (const text of texts) {
    for (const re of COINED_RES) {
      for (const m of text.matchAll(re)) {
        const parts = nameParts(m[0]);
        const key = parts.join("");
        if (parts.length < 2 || key.length > 24 || !parts.every(isNameWord)) continue;
        const entry = out.get(key) ?? { parts, forms: new Map<string, number>() };
        entry.forms.set(m[0], (entry.forms.get(m[0]) ?? 0) + 1);
        out.set(key, entry);
      }
    }
  }
  return out;
}

/** Every spelling of a name: its words joined by nothing, a space, `_` or `-`, any case. */
export function mentionRe(parts: string[]): RegExp {
  const escaped = parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped.join("[\\s_-]?")}(?![\\p{L}\\p{N}])`, "giu");
}

/** The person's spelling for a title: their most frequent form; a lowercase one takes the vault's capitalised form. */
function displayName(parts: string[], forms: Map<string, number>, spoken: Map<string, number>): string {
  const best = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const said = best(spoken) ?? best(forms) ?? parts.join(" ");
  if (said !== said.toLowerCase()) return said.replace(/_/g, " ");
  // A capitalised form the vault uses; on a tie the one that reads as a name ("Lumen Desk" over "Lumen desk").
  const capitals = (form: string) => (form.match(/\p{Lu}/gu) ?? []).length;
  const capitalised = [...new Map([...forms, ...spoken].filter(([form]) => /^\p{Lu}/u.test(form)))];
  const cap = capitalised.sort((a, b) => b[1] - a[1] || capitals(b[0]) - capitals(a[0]) || a[0].localeCompare(b[0]))[0]?.[0];
  if (cap) return cap.replace(/_/g, " ");
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

/** Lines the ingest pipeline writes above what the person said (`Source: …`, `Raw artifact: …`, `Transcribed by …`). */
const INGEST_HEADER_RE = /^(?:(?:raw artifact(?: url| sha256)?|extraction artifact|media type|source(?: timestamp| message| chat)?|received timestamp|user context|sha256|original|vision model|mime type|file name)\s*:|transcribed by\b|(?:voice note|screenshot\/image|image|document|file|pdf) "[^"]*")/i;

/** What the person said or wrote in a capture: its text without the ingest header lines (titles repeat the text). */
const spokenText = (capture: LogCapture) => capture.content.split("\n").filter(line => !INGEST_HEADER_RE.test(line.trim())).join("\n");

/** Every word of the name means something: not a stopword (`with the`), spoken filler or ingest vocabulary (`voice note`). */
const isNameWord = (part: string) => [...tokens(part)].some(t => !isFillerTerm(t));

interface PageTitle {
  path: string;
  key: string;
  subject: string | null;
  generated: boolean;
}

async function pageTitles(vaultPath: string, files: string[]): Promise<PageTitle[]> {
  const out: PageTitle[] = [];
  for (const path of files) {
    if (!isTreePage(path)) continue;
    const raw = await readFile(join(vaultPath, path), "utf8").catch(() => "");
    const { frontmatter } = parseNote(raw);
    const title = typeof frontmatter?.title === "string" ? frontmatter.title : basenameOf(path);
    const subject = typeof frontmatter?.[SUBJECT_FIELD] === "string" ? String(frontmatter[SUBJECT_FIELD]) : null;
    out.push({ path, key: keyOf(title), subject, generated: frontmatter?.generated === SUBJECT_GENERATOR });
  }
  return out;
}

/** Names the person keeps saying in their own captures (window ending `today`), with the page about each, if any. */
export async function findNamedSubjects(vaultPath: string, today: string, files?: string[]): Promise<NamedSubject[]> {
  const all = files ?? (await listMarkdownFiles(vaultPath));
  const captures = await readLogCaptures(vaultPath, all);
  // The vault's vocabulary of coined names: pages and every Log entry (an agent report spells a product name as well as anyone).
  const texts: string[] = [];
  for (const path of all) {
    if (!path.endsWith(".md") || path.startsWith("Log/")) continue;
    texts.push(await readFile(join(vaultPath, path), "utf8").catch(() => ""));
  }
  for (const capture of captures.values()) texts.push(`${capture.title}\n${capture.content}`);
  const names = coinedNames(texts);

  const recent = [...captures.values()]
    .filter(c => c.origin === "user")
    .filter(c => { const age = daysBetween(c.date, today); return age >= 0 && age <= SUBJECT_WINDOW_DAYS; })
    .sort((a, b) => a.key.localeCompare(b.key));
  const titles = await pageTitles(vaultPath, all);
  const out: NamedSubject[] = [];
  for (const [key, { parts, forms }] of names) {
    const re = mentionRe(parts);
    const spoken = new Map<string, number>();
    const hits: NamedSubject["captures"] = [];
    for (const capture of recent) {
      const found = [...spokenText(capture).matchAll(re)].map(m => m[0]);
      if (!found.length) continue;
      for (const form of found) spoken.set(form, (spoken.get(form) ?? 0) + 1);
      hits.push({ capture, mentions: found.length });
    }
    const mentions = hits.reduce((sum, h) => sum + h.mentions, 0);
    const days = new Set(hits.map(h => h.capture.date)).size;
    if (mentions < SUBJECT_MIN_MENTIONS || hits.length < SUBJECT_MIN_CAPTURES || days < SUBJECT_MIN_DAYS) continue;
    const page = titles.find(t => t.subject === key)?.path ?? titles.find(t => t.key.includes(key))?.path ?? null;
    out.push({ key, display: displayName(parts, forms, spoken), captures: hits, mentions, days, page });
  }
  return out.sort((a, b) => b.mentions - a.mentions || a.key.localeCompare(b.key));
}

/** One page line per capture: date, how often it names the subject, the words around the first mention, the citation. */
export function subjectLine(subject: Pick<NamedSubject, "key">, parts: string[], hit: { capture: LogCapture; mentions: number }): string {
  const text = spokenText(hit.capture).replace(/\s+/g, " ");
  const at = text.search(mentionRe(parts));
  const start = Math.max(0, at - EXCERPT_CHARS / 2);
  let excerpt = text.slice(start, start + EXCERPT_CHARS).trim().replace(/[[\]|]/g, " ").replace(/\s+/g, " ");
  if (start > 0) excerpt = `…${excerpt}`;
  if (start + EXCERPT_CHARS < text.length) excerpt = `${excerpt}…`;
  const [date, anchor] = hit.capture.key.split("#^");
  const times = hit.mentions === 1 ? "once" : `${hit.mentions} times`;
  return `- ${date} · named ${times} · “${excerpt}” ([[${date}#^${anchor}]])`;
}

const subjectSummary = (subject: NamedSubject) =>
  `Your own captures that name ${subject.display}: ${subject.captures.length} in the last ${SUBJECT_WINDOW_DAYS} days, on ${subject.days} days, latest ${subject.captures.at(-1)!.capture.date}.`;

function renderSubjectPage(subject: NamedSubject, today: string): string {
  const parts = nameParts(subject.display);
  const summary = subjectSummary(subject);
  return [
    "---",
    `title: ${JSON.stringify(subject.display)}`,
    "type: project",
    "tags: []",
    `created: "${today}"`,
    `updated: "${today}"`,
    `summary: ${JSON.stringify(summary)}`,
    `generated: ${SUBJECT_GENERATOR}`,
    `${SUBJECT_FIELD}: ${subject.key}`,
    `parent: "${TREE_PARENT}"`,
    "---",
    "",
    `# ${subject.display}`,
    "",
    `Zenod started this page because you keep naming ${subject.display} in your own messages and voice notes, and no page was about it yet. Each line cites one of your captures; the Log holds the full text.`,
    "",
    // Only the Tree: a link to the pages these captures were filed on would tie the subject back into their topic.
    "Part of your [[Tree|memory tree]].",
    "",
    "## Your captures",
    "",
    ...subject.captures.map(hit => subjectLine(subject, parts, hit)),
    "",
  ].join("\n");
}

export interface MaterializedSubject {
  key: string;
  display: string;
  path: string;
  created: boolean;
  /** Citation lines added. */
  added: number;
}

/**
 * Give each named subject without a page a page of its own (under `Projects/`), and add newly
 * captured mentions to the subject pages Zenod made before. Pages the person or the librarian
 * wrote are never edited here.
 */
export async function materializeNamedSubjects(vaultPath: string, today: string, writes: TrackedWrites): Promise<MaterializedSubject[]> {
  const files = await listMarkdownFiles(vaultPath);
  const subjects = await findNamedSubjects(vaultPath, today, files);
  const out: MaterializedSubject[] = [];
  for (const subject of subjects) {
    if (subject.page === null) {
      const name = subject.display.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim();
      let path = `${SUBJECT_DIR}/${name}.md`;
      for (let n = 2; files.some(f => f.toLowerCase() === path.toLowerCase()); n++) path = `${SUBJECT_DIR}/${name} (${n}).md`;
      await writes.write(path, renderSubjectPage(subject, today));
      files.push(path);
      out.push({ key: subject.key, display: subject.display, path, created: true, added: subject.captures.length });
      continue;
    }
    const raw = await readFile(join(vaultPath, subject.page), "utf8").catch(() => "");
    const { frontmatter } = parseNote(raw);
    if (frontmatter?.generated !== SUBJECT_GENERATOR) continue;
    const cited = new Set([...raw.matchAll(CITATION_RE)].map(m => `${m[1]}#^${m[2]}`));
    const parts = nameParts(subject.display);
    const fresh = subject.captures.filter(hit => !cited.has(hit.capture.key));
    if (!fresh.length) continue;
    const next = outsideOpsRollup(raw, head => `${head.replace(/\n*$/, "\n")}${fresh.map(hit => subjectLine(subject, parts, hit)).join("\n")}\n`)
      .replace(/^updated: .*$/m, `updated: "${today}"`)
      .replace(/^summary: .*$/m, `summary: ${JSON.stringify(subjectSummary(subject))}`);
    await writes.write(subject.page, next);
    out.push({ key: subject.key, display: subject.display, path: subject.page, created: false, added: fresh.length });
  }
  return out;
}
