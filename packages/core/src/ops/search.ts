import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hit } from "../types.js";
import { isFilingReceiptPath, listAttachmentFiles, listMarkdownFiles, tierOf } from "../vault/files.js";
import { scanVault } from "../vault/pages.js";
import { vaultSourceRef, type VaultSourceContext } from "../vault/source.js";

import { pendingTopicDiscovery } from "./pendingDiscovery.js";

const MAX_HITS = 20;

interface SearchScore {
  score: number;
  snippet: string;
  matchedTerms: Set<string>;
  exactPhrase: boolean;
}

const ASCII = /^[\x00-\x7f]*$/;

function normalizePhrase(value: string): string {
  // E15-Q4: ASCII text (most matched lines) needs no NFKC, and its letters and digits are [a-z0-9]
  // once lowercased: the same result, without the Unicode passes, on tens of thousands of lines.
  if (ASCII.test(value)) return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * E15-Q4: normalized text, remembered across searches. One filing runs about 17 searches whose body
 * pass matches most lines of the vault; the lines are the same each time. Bounded: the memory is
 * dropped whole once it holds MAX_NORMALIZED texts.
 */
const MAX_NORMALIZED = 200_000;
const normalizedTexts = new Map<string, string>();
function normalizedText(text: string): string {
  let value = normalizedTexts.get(text);
  if (value === undefined) {
    if (normalizedTexts.size >= MAX_NORMALIZED) normalizedTexts.clear();
    value = normalizePhrase(text);
    normalizedTexts.set(text, value);
  }
  return value;
}

function queryTerms(query: string): string[] {
  const lexicalTerms = query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_]+(?:[-'][\p{L}\p{N}_]+)*/gu) ?? [];
  return [...new Set(lexicalTerms.map(normalizePhrase).filter(Boolean))];
}

/**
 * Deterministic two-pass search — no LLM, target <500ms.
 * Pass 1 scores the frontmatter index (title, tags, summary, filename);
 * pass 2 greps note bodies (ripgrep when available, JS scan otherwise).
 */
export async function searchVault(vaultPath: string, query: string, location: VaultSourceContext = {}): Promise<Hit[]> {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const normalizedQuery = normalizePhrase(query);

  const scores = new Map<string, SearchScore>();
  // E15-Q4: a long filing query has up to 128 terms; normalize each text once, not once per term or search.
  const norm = normalizedText;
  const bump = (path: string, score: number, snippet: string, matchedText: string) => {
    if (isFilingReceiptPath(path)) return;
    const normalizedText = norm(matchedText);
    const cur = scores.get(path);
    if (cur) {
      cur.score += score;
      if (!cur.snippet && snippet) cur.snippet = snippet;
      // Terms this path already matched need no second look (a busy page matches on many lines).
      if (cur.matchedTerms.size < terms.length) {
        for (const term of terms) {
          if (!cur.matchedTerms.has(term) && normalizedText.includes(term)) cur.matchedTerms.add(term);
        }
      }
      if (!cur.exactPhrase && normalizedText.includes(normalizedQuery)) cur.exactPhrase = true;
    } else {
      scores.set(path, {
        score,
        snippet,
        matchedTerms: new Set(terms.filter((term) => normalizedText.includes(term))),
        exactPhrase: normalizedText.includes(normalizedQuery),
      });
    }
  };

  // Pass 1: frontmatter index.
  const snapshot = await scanVault(vaultPath);
  for (const page of snapshot.pages) {
    const title = page.title.toLowerCase();
    const summary = page.summary.toLowerCase();
    const base = page.path.toLowerCase();
    const [normalTitle, normalSummary, normalBase] = [norm(title), norm(summary), norm(base)];
    for (const term of terms) {
      if (normalTitle === term) bump(page.path, 10, page.summary, title);
      else if (normalTitle.includes(term)) bump(page.path, 5, page.summary, title);
      const matchingTag = page.tags.find((tag) => norm(tag) === term);
      if (matchingTag) bump(page.path, 4, page.summary, matchingTag);
      if (normalSummary.includes(term)) bump(page.path, 2, page.summary, summary);
      if (normalBase.includes(term)) bump(page.path, 3, page.summary, base);
    }
  }

  // Pass 1b: evidence tier — Log files by path (e.g. a date in the query) and
  // raw artifacts by filename. Bodies of Log files are covered by pass 2;
  // attachments are binary, so their filename is all there is to match.
  for (const file of snapshot.files) {
    if (tierOf(file) !== "evidence") continue;
    const lower = file.toLowerCase();
    for (const term of terms) {
      if (norm(lower).includes(term)) bump(file, 3, "(evidence log)", lower);
    }
  }
  for (const file of await listAttachmentFiles(vaultPath)) {
    const lower = file.toLowerCase();
    for (const term of terms) {
      if (norm(lower).includes(term)) bump(file, 3, "(attachment artifact)", lower);
    }
  }

  // Pass 2: bodies.
  const grepTerms = [...new Set(terms.flatMap((term) => term.split(" ")))];
  const bodyHits = await grepBodies(vaultPath, grepTerms).catch(() => scanBodies(vaultPath, grepTerms));
  for (const hit of bodyHits) bump(hit.path, 1, hit.line.trim().slice(0, 200), hit.line);

  for (const hint of await pendingTopicDiscovery(vaultPath, snapshot.files, label => terms.some(term => norm(label).includes(term)))) {
    bump(hint.ref, 3, `Pending topic discovery (read original evidence): ${hint.label}`, hint.label);
  }

  const rankBand = Math.max(...[...scores.values()].map(({ score }) => score), 0) + 1;
  return [...scores.entries()]
    .map(([path, result]) => ({
      path,
      ...result,
      allTerms: result.matchedTerms.size === terms.length,
      rankedScore:
        result.score +
        (result.exactPhrase ? rankBand * 2 : 0) +
        (result.matchedTerms.size === terms.length ? rankBand : 0),
    }))
    .sort((a, b) => {
      if (a.exactPhrase !== b.exactPhrase) return a.exactPhrase ? -1 : 1;
      if (a.allTerms !== b.allTerms) return a.allTerms ? -1 : 1;
      return b.rankedScore - a.rankedScore || a.path.localeCompare(b.path);
    })
    .slice(0, MAX_HITS)
    .map(({ path, rankedScore, snippet }) => ({
      snippet,
      score: rankedScore,
      ...vaultSourceRef(location, path.split("#^")[0]!, path.includes("#^") ? `^${path.split("#^")[1]}` : undefined),
      path,
    }));
}

interface BodyHit {
  path: string;
  line: string;
}

/**
 * ripgrep pass: case-insensitive fixed-string match over markdown bodies, any term matches (OR — same
 * semantics as scanBodies). Plain `path NUL line` output: a long filing query matches tens of thousands
 * of lines, and parsing one JSON event per line cost seconds per search (E15-Q4).
 */
function grepBodies(vaultPath: string, terms: string[]): Promise<BodyHit[]> {
  return new Promise((resolve, reject) => {
    const rg = spawn(
      "rg",
      [
        "-i",
        "--fixed-strings",
        "--no-heading",
        "--with-filename",
        "--null",
        "--no-line-number",
        "--color",
        "never",
        "--glob",
        "*.md",
        "--glob",
        "!.obsidian/**",
        ...terms.flatMap((t) => ["-e", t]),
        ".",
      ],
      { cwd: vaultPath },
    );
    const hits: BodyHit[] = [];
    const chunks: Buffer[] = [];
    rg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    rg.on("error", reject); // rg not installed
    rg.on("close", (code) => {
      if (code !== 0 && code !== 1) return reject(new Error(`rg exited with ${code}`)); // 1 = no matches
      for (const line of Buffer.concat(chunks).toString("utf8").split("\n")) {
        const split = line.indexOf("\0");
        if (split < 0) continue;
        const path = line.slice(0, split).replace(/^\.\//, "");
        const text = line.slice(split + 1).replace(/\r$/, "");
        if (text && !isFilingReceiptPath(path)) hits.push({ path, line: text });
      }
      resolve(hits);
    });
  });
}

/** Fallback when ripgrep is unavailable: plain JS substring scan. */
async function scanBodies(vaultPath: string, terms: string[]): Promise<BodyHit[]> {
  const hits: BodyHit[] = [];
  for (const file of await listMarkdownFiles(vaultPath)) {
    if (isFilingReceiptPath(file)) continue;
    const content = await readFile(join(vaultPath, file), "utf8");
    for (const line of content.split("\n")) {
      const lower = line.toLowerCase();
      if (terms.some((t) => lower.includes(t))) {
        hits.push({ path: file, line });
      }
    }
  }
  return hits;
}
