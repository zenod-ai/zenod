import type { BrainLlm, Classification, ClassifyInput, ComposePageInput } from "../llm/types.js";
import { searchVault } from "../ops/search.js";
import { parseNote, serializeNote } from "../vault/frontmatter.js";
import { extractCitations, SUMMARY_MAX_CHARS, type PageIndexEntry, type VaultSnapshot } from "../vault/pages.js";

/** Character budgets, not provider token counts. Historical bodies remain untouched. */
export { SUMMARY_MAX_CHARS } from "../vault/pages.js";
export const CANDIDATE_LIMIT = 24;
export const SECTION_CONTEXT_MAX_CHARS = 6000;
const compact = (s: string, limit: number) => Array.from(s.replace(/\s+/g, " ").trim()).slice(0, limit).join("");
const key = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const STOP_WORDS = new Set("the and for with this that from into have has was are will can should about also its our their your".split(" "));
const words = (s: string) => [...new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter((word) => !STOP_WORDS.has(word));
export const compactPage = (page: PageIndexEntry): PageIndexEntry => ({ ...page,
  factKeys: (page.factKeys ?? []).slice(0, 8).filter((key, index, keys) => keys.slice(0, index + 1).join(",").length <= 320),
  title: compact(page.title, 120), aliases: (page.aliases ?? []).slice(0, 8).map((alias) => compact(alias, 120)), tags: page.tags.slice(0, 12).map((tag) => compact(tag, 40)), summary: compact(page.summary, SUMMARY_MAX_CHARS) });

/** Reuse body search, then rank compact metadata; explicit path/title hints win. */
export async function candidatePages(vaultPath: string, snapshot: VaultSnapshot, content: string, hints: string[], exclude: string[] = []): Promise<PageIndexEntry[]> {
  const terms = words(content).slice(0, 48);
  const hits = await searchVault(vaultPath, [...hints, ...terms].join(" "));
  const hitScores = new Map(hits.map((hit, index) => [hit.path, 20 - index]));
  return snapshot.pages.filter((page) => !exclude.includes(page.path)).map((page) => {
    const metadata = `${page.path} ${page.title} ${page.tags.join(" ")} ${(page.aliases ?? []).join(" ")} ${page.summary}`.toLowerCase();
    const hinted = hints.some((hint) => key(hint).includes(key(page.path.replace(/\.md$/, ""))) || key(hint).includes(key(page.title)));
    return { page, score: (hinted ? 10000 : 0) + (hitScores.get(page.path) ?? 0) + terms.reduce((score, term) => score + (metadata.includes(term) ? 1 : 0), 0) };
  }).sort((a, b) => b.score - a.score || a.page.path.localeCompare(b.page.path)).slice(0, CANDIDATE_LIMIT).map(({ page }) => compactPage(page));
}

/** One bounded fallback search when a partial catalog gives uncertain or new-page decisions. */
export async function classifyCandidates(llm: Pick<BrainLlm, "classify">, vaultPath: string, snapshot: VaultSnapshot, input: ClassifyInput): Promise<Classification> {
  const initial = await candidatePages(vaultPath, snapshot, input.content, input.hints);
  const run = (pages: PageIndexEntry[], fallback: boolean) => llm.classify({ ...input, pageIndex: pages,
    hints: [...input.hints, `Candidate catalog: ${pages.length}/${snapshot.pages.length} pages; ${fallback ? "fallback search" : "initial search"}. Omitted pages may exist; do not equate this set with the whole vault.`] });
  let result = await run(initial, false);
  const decisions = result.topics ?? [result];
  if (snapshot.pages.length > initial.length && decisions.some((topic) => topic.confidence < 0.7 || topic.pages.some((page) => page.action === "create"))) {
    const probes = decisions.flatMap((topic) => [topic.summary, ...topic.pages.map((page) => page.title)]);
    try {
      const fallback = await candidatePages(vaultPath, snapshot, probes.join(" "), input.hints, initial.map((page) => page.path));
      // Keep explicit hints and strongest initial candidates while examining previously omitted candidates.
      result = await run([...initial.slice(0, 8), ...fallback.slice(0, CANDIDATE_LIMIT - 8)], true);
    } catch {
      // Catalog expansion is optional. A failed refinement must not discard a
      // validated first result or trigger a complete classification retry.
      // Preserve its uncertainty and still run the full-snapshot reconciliation below.
      console.warn("[classify] optional catalog refinement unavailable; retaining initial classification");
    }
  }
  const reconcile = (pages: Classification["pages"]) => pages.map((page) => {
    const exact = snapshot.pages.find((candidate) => candidate.path.replace(/\.md$/, "").toLowerCase() === page.path.replace(/\.md$/, "").toLowerCase());
    const matches = snapshot.pages.filter((candidate) => key(candidate.path.replace(/\.md$/, "")) === key(page.path.replace(/\.md$/, "")) || key(candidate.title) === key(page.title)
      || (candidate.aliases ?? []).some((alias) => key(alias) === key(page.title)));
    const existing = exact ?? (page.action === "create" && matches.length === 1 ? matches[0] : undefined);
    // Deterministic near-duplicate safeguard: an existing title/path cannot become a second page.
    return existing ? { ...page, path: existing.path, title: existing.title, action: "update" as const } : page;
  });
  return { ...result, pages: reconcile(result.pages), ...(result.topics ? { topics: result.topics.map((topic) => ({ ...topic, pages: reconcile(topic.pages) })) } : {}) };
}

export async function relevantLinks(vaultPath: string, snapshot: VaultSnapshot, path: string, evidence: string): Promise<string[]> {
  const pages = await candidatePages(vaultPath, snapshot, evidence, [], [path]);
  const terms = words(evidence);
  const links = pages.filter((page) => terms.some((term) => `${page.title} ${page.summary} ${page.tags.join(" ")}`.toLowerCase().includes(term)))
    .slice(0, 3).map((page) => `[[${page.path.replace(/\.md$/, "")}|${page.title}]]`);
  const folder = path.split("/")[0]!;
  if (snapshot.files.includes(`${folder}/${folder} Index.md`)) links.push(`[[${folder}/${folder} Index|${folder}]]`);
  if (!links.length && snapshot.files.includes("Index.md")) links.push("[[Index]]");
  return links;
}

interface Section { start: number; end: number; text: string }
function focusedSection(body: string, evidence: string): Section | undefined {
  const headings = [...body.matchAll(/^## [^\n]+/gm)];
  const terms = words(evidence);
  return headings.map((match, i) => {
    const start = match.index!;
    const end = headings[i + 1]?.index ?? body.length;
    const text = body.slice(start, end);
    const heading = match[0].toLowerCase();
    return { start, end, text, score: terms.filter((term) => heading.includes(term)).length };
  }).filter((section) => section.score > 0 && section.text.length <= SECTION_CONTEXT_MAX_CHARS)
    .sort((a, b) => b.score - a.score || a.start - b.start)[0];
}

/** Compose only one bounded section; restore all unrelated body bytes mechanically. */
export async function composeFocusedPage(llm: Pick<BrainLlm, "composePage">, input: ComposePageInput): Promise<string> {
  const original = input.currentContent === null ? null : parseNote(input.currentContent);
  if (original && !original.frontmatter) return "Invalid existing frontmatter; refusing a destructive rewrite.\n";
  const section = original ? focusedSection(original.body, `${input.classification.summary} ${input.evidenceEntry}`) : undefined;
  const projection = original ? serializeNote({ title: compact(String(original.frontmatter!.title ?? ""), 120), type: original.frontmatter!.type, tags: input.tagVocabulary.filter((tag) => Array.isArray(original.frontmatter!.tags) && original.frontmatter!.tags.includes(tag)).slice(0, 12), created: original.frontmatter!.created, updated: input.today, summary: compact(String(original.frontmatter!.summary ?? ""), SUMMARY_MAX_CHARS),
    description: compact(String(original.frontmatter!.summary ?? ""), SUMMARY_MAX_CHARS) }, section?.text ?? "") : null;
  const raw = await llm.composePage({ ...input, currentContent: projection, focusedUpdate: Boolean(original), summaryMaxChars: SUMMARY_MAX_CHARS,
    classification: { ...input.classification, pages: input.classification.pages.map((page) => page.path === input.path ? { ...page, action: original ? "update" : "create" } : page) } });
  const next = parseNote(raw);
  // Model-authored frontmatter may not bypass the explicit quote validation below.
  if (next.frontmatter) { delete next.frontmatter.memoryFacts; delete next.frontmatter.aliasEvidence; delete next.frontmatter.aliases; }
  const title = String(original?.frontmatter?.title ?? next.frontmatter?.title ?? "");
  const aliasEvidence = validatedAliases(input.classification.pages.find((page) => page.path === input.path), title, input.evidenceEntry, input.citation);
  const existingAliases = Array.isArray(original?.frontmatter?.aliasEvidence) ? original.frontmatter.aliasEvidence : [];
  const aliases = [...new Map([...existingAliases, ...aliasEvidence].map((record) => [JSON.stringify(record), record])).values()];
  if (!next.frontmatter || typeof next.frontmatter.summary !== "string" || !next.frontmatter.summary.trim()
    || Array.from(next.frontmatter.summary).length > SUMMARY_MAX_CHARS || /[\r\n]/.test(next.frontmatter.summary)) return "Invalid composed summary budget or frontmatter.\n";
  if (!next.body.includes(input.citation)) return "Composition omitted the assigned evidence citation.\n";
  if (!original) return serializeNote({ ...next.frontmatter, description: next.frontmatter.summary, ...(aliases.length ? { aliasEvidence: aliases } : {}) }, next.body);
  // A section update may add claims, but may not erase/rephrase any old claim, link, or citation.
  const oldLines = (section?.text ?? "").split("\n").filter((line) => line.trim());
  let offset = 0;
  const nextLines = next.body.split("\n");
  for (const line of oldLines) {
    const at = nextLines.indexOf(line, offset);
    if (at < 0) return "Composition removed existing section content.\n";
    offset = at + 1;
  }
  const body = section
    ? original.body.slice(0, section.start) + next.body.trimEnd() + "\n\n" + original.body.slice(section.end)
    : original.body + (original.body.endsWith("\n") ? "\n" : "\n\n") + next.body.trimStart();
  if (extractCitations(original.body).some(({ date, anchor }) => !body.includes(`[[${date}#^${anchor}`))) return "Composition removed prior citations.\n";
  // Preserve identity, custom metadata and historical summary text when shortening an oversized legacy summary.
  const priorSummary = String(original.frontmatter!.summary ?? "");
  const history = Array.from(priorSummary).length > SUMMARY_MAX_CHARS && !body.includes(priorSummary)
    ? `\n\n## Previous summary\n\n${priorSummary}\n` : "";
  return serializeNote({ ...original.frontmatter, updated: input.today, summary: next.frontmatter.summary,
    description: next.frontmatter.summary, ...(aliases.length ? { aliasEvidence: aliases } : {}) }, body + history);
}

/** Shorten only a touched legacy summary and retain its exact former text in the body. */
export function boundExistingSummary(raw: string): string {
  const { frontmatter, body } = parseNote(raw);
  if (!frontmatter || typeof frontmatter.summary !== "string") return raw;
  const bounded = compact(frontmatter.summary, SUMMARY_MAX_CHARS);
  if (bounded === frontmatter.summary) return raw;
  return serializeNote({ ...frontmatter, summary: bounded, description: bounded },
    body + `\n\n## Previous summary\n\n${frontmatter.summary}\n`);
}

function validatedAliases(page: Classification["pages"][number] | undefined, title: string, evidence: string, citation: string) {
  return (page?.aliases ?? [])
    .filter((alias) => alias.name.trim() && title && alias.evidenceQuote.includes(alias.name) && alias.evidenceQuote.includes(title) && evidence.includes(alias.evidenceQuote))
    .map((alias) => ({ name: alias.name, quote: alias.evidenceQuote, citation }));
}

export function appendAliasEvidence(raw: string, page: Classification["pages"][number], evidence: string, citation: string): string {
  const parsed = parseNote(raw);
  if (!parsed.frontmatter) return raw;
  const added = validatedAliases(page, String(parsed.frontmatter.title ?? ""), evidence, citation);
  if (!added.length) return raw;
  const old = Array.isArray(parsed.frontmatter.aliasEvidence) ? parsed.frontmatter.aliasEvidence : [];
  const aliasEvidence = [...new Map([...old, ...added].map((record) => [JSON.stringify(record), record])).values()];
  return serializeNote({ ...parsed.frontmatter, aliasEvidence }, parsed.body);
}
