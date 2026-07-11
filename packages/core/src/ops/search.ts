import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hit } from "../types.js";
import { listAttachmentFiles, listMarkdownFiles, tierOf } from "../vault/files.js";
import { scanVault } from "../vault/pages.js";
import { githubUrl, type VaultLocation } from "../vault/github.js";

const MAX_HITS = 20;

interface SearchScore {
  score: number;
  snippet: string;
  matchedTerms: Set<string>;
  exactPhrase: boolean;
}

function normalizePhrase(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
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
export async function searchVault(vaultPath: string, query: string, location: VaultLocation = {}): Promise<Hit[]> {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const normalizedQuery = normalizePhrase(query);

  const scores = new Map<string, SearchScore>();
  const bump = (path: string, score: number, snippet: string, matchedText: string) => {
    const normalizedText = normalizePhrase(matchedText);
    const cur = scores.get(path);
    if (cur) {
      cur.score += score;
      if (!cur.snippet && snippet) cur.snippet = snippet;
      for (const term of terms) {
        if (normalizedText.includes(term)) cur.matchedTerms.add(term);
      }
      if (normalizedText.includes(normalizedQuery)) cur.exactPhrase = true;
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
    for (const term of terms) {
      if (normalizePhrase(title) === term) bump(page.path, 10, page.summary, title);
      else if (normalizePhrase(title).includes(term)) bump(page.path, 5, page.summary, title);
      const matchingTag = page.tags.find((tag) => normalizePhrase(tag) === term);
      if (matchingTag) bump(page.path, 4, page.summary, matchingTag);
      if (normalizePhrase(summary).includes(term)) bump(page.path, 2, page.summary, summary);
      if (normalizePhrase(base).includes(term)) bump(page.path, 3, page.summary, base);
    }
  }

  // Pass 1b: evidence tier — Log files by path (e.g. a date in the query) and
  // raw artifacts by filename. Bodies of Log files are covered by pass 2;
  // attachments are binary, so their filename is all there is to match.
  for (const file of snapshot.files) {
    if (tierOf(file) !== "evidence") continue;
    const lower = file.toLowerCase();
    for (const term of terms) {
      if (normalizePhrase(lower).includes(term)) bump(file, 3, "(evidence log)", lower);
    }
  }
  for (const file of await listAttachmentFiles(vaultPath)) {
    const lower = file.toLowerCase();
    for (const term of terms) {
      if (normalizePhrase(lower).includes(term)) bump(file, 3, "(attachment artifact)", lower);
    }
  }

  // Pass 2: bodies.
  const grepTerms = [...new Set(terms.flatMap((term) => term.split(" ")))];
  const bodyHits = await grepBodies(vaultPath, grepTerms).catch(() => scanBodies(vaultPath, grepTerms));
  for (const hit of bodyHits) bump(hit.path, 1, hit.line.trim().slice(0, 200), hit.line);

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
      path,
      snippet,
      score: rankedScore,
      githubUrl: githubUrl(location, path),
    }));
}

interface BodyHit {
  path: string;
  line: string;
}

/** ripgrep pass: case-insensitive fixed-string match over markdown bodies, any term matches (OR — same semantics as scanBodies). */
function grepBodies(vaultPath: string, terms: string[]): Promise<BodyHit[]> {
  return new Promise((resolve, reject) => {
    const rg = spawn(
      "rg",
      [
        "--json",
        "-i",
        "--fixed-strings",
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
    let buffer = "";
    rg.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as { type: string; data?: { path?: { text?: string }; lines?: { text?: string } } };
          if (event.type === "match" && event.data?.path?.text && event.data.lines?.text) {
            hits.push({ path: event.data.path.text.replace(/^\.\//, ""), line: event.data.lines.text });
          }
        } catch {
          // ignore malformed event lines
        }
      }
    });
    rg.on("error", reject); // rg not installed
    rg.on("close", (code) => {
      if (code === 0 || code === 1) resolve(hits); // 1 = no matches
      else reject(new Error(`rg exited with ${code}`));
    });
  });
}

/** Fallback when ripgrep is unavailable: plain JS substring scan. */
async function scanBodies(vaultPath: string, terms: string[]): Promise<BodyHit[]> {
  const hits: BodyHit[] = [];
  for (const file of await listMarkdownFiles(vaultPath)) {
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
