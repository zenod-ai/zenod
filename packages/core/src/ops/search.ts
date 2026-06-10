import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hit } from "../types.js";
import { listMarkdownFiles } from "../vault/files.js";
import { scanVault } from "../vault/pages.js";
import { githubUrl, type VaultLocation } from "../vault/github.js";

const MAX_HITS = 20;

/**
 * Deterministic two-pass search — no LLM, target <500ms.
 * Pass 1 scores the frontmatter index (title, tags, summary, filename);
 * pass 2 greps note bodies (ripgrep when available, JS scan otherwise).
 */
export async function searchVault(vaultPath: string, query: string, location: VaultLocation = {}): Promise<Hit[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scores = new Map<string, { score: number; snippet: string }>();
  const bump = (path: string, score: number, snippet: string) => {
    const cur = scores.get(path);
    if (cur) {
      cur.score += score;
      if (!cur.snippet && snippet) cur.snippet = snippet;
    } else {
      scores.set(path, { score, snippet });
    }
  };

  // Pass 1: frontmatter index.
  const snapshot = await scanVault(vaultPath);
  for (const page of snapshot.pages) {
    const title = page.title.toLowerCase();
    const summary = page.summary.toLowerCase();
    const base = page.path.toLowerCase();
    for (const term of terms) {
      if (title === term) bump(page.path, 10, page.summary);
      else if (title.includes(term)) bump(page.path, 5, page.summary);
      if (page.tags.some((t) => t.toLowerCase() === term)) bump(page.path, 4, page.summary);
      if (summary.includes(term)) bump(page.path, 2, page.summary);
      if (base.includes(term)) bump(page.path, 3, page.summary);
    }
  }

  // Pass 2: bodies.
  const bodyHits = await grepBodies(vaultPath, query).catch(() => scanBodies(vaultPath, terms));
  for (const hit of bodyHits) bump(hit.path, 1, hit.line.trim().slice(0, 200));

  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, MAX_HITS)
    .map(([path, { score, snippet }]) => ({
      path,
      snippet,
      score,
      githubUrl: githubUrl(location, path),
    }));
}

interface BodyHit {
  path: string;
  line: string;
}

/** ripgrep pass: case-insensitive fixed-string match over markdown bodies. */
function grepBodies(vaultPath: string, query: string): Promise<BodyHit[]> {
  return new Promise((resolve, reject) => {
    const rg = spawn(
      "rg",
      ["--json", "-i", "--fixed-strings", "--glob", "*.md", "--glob", "!.obsidian/**", query, "."],
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
