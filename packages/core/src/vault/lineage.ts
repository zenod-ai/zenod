import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { basenameOf, listMarkdownFiles } from "./files.js";
import { CITATION_RE } from "./pages.js";
import { buildTreeIndex, GROUP_HEADINGS, readTree, type MemoryKind, type ParsedTree } from "./tree.js";

/**
 * Retrieval lineage (EPIC-9 E9-3a): where a memory sits in the tree, root → leaf,
 * plus the Log evidence it came from. Read-only and deterministic; no LLM.
 *
 * Built on the E9-2a tree schema (./tree.ts). A page whose lineage does not resolve
 * (no `parent`, a broken parent, a cycle — today's whole vault until E9-2c) is
 * "unplaced" with an empty lineage, never an error.
 */

const MAX_EVIDENCE = 5;

export interface LineageNode {
  /** Vault-relative page path, or null for a level-0 group (Working / Long-term memory). */
  path: string | null;
  title: string;
  memory: MemoryKind | null;
}

export interface MemoryLineage {
  placement: "placed" | "unplaced";
  /** Level-0 group → level-1 root → … → the memory itself. Empty when unplaced. */
  lineage: LineageNode[];
  /** Log evidence refs the page cites, e.g. `Log/2026-10-31.md#^e-c64e3b` (first 5). */
  evidence: string[];
}

export interface MemoryTreeNodeView extends MemoryLineage {
  /** The node one level up (the level-0 group for a root); null when unplaced. */
  parent: LineageNode | null;
  /** Pages whose `parent:` resolves to this page, sorted by path. */
  children: LineageNode[];
}

/** Where one answer source sits in the tree (E9-3b): what `ask_brain` cites next to its answer. */
export interface AnswerLineage {
  /** The answer source, as returned in `sources[].path` (a page, or `Log/….md#^e-…`). */
  source: string;
  /** The placed page holding it: the source page itself, or the deepest placed page citing a Log entry. */
  page: string;
  lineage: LineageNode[];
  /** The Log evidence the path is anchored to, when known. */
  evidence?: string;
  /** `Working memory › Cabin decision › Oakmere ← Log/2026-10-14.md#^e-…` */
  text: string;
}

export interface MemoryTreeIndex {
  lineageOf(path: string): Promise<MemoryLineage>;
  nodeView(path: string): Promise<MemoryTreeNodeView>;
  /** Placed pages citing a Log evidence ref (`Log/2026-10-31.md#^e-c64e3b`), deepest first. */
  placedCitersOf(evidenceRef: string): Promise<string[]>;
  /** Tree paths for answer sources, deduplicated by page, at most `max`; unplaced sources are skipped. */
  answerLineage(sources: readonly string[], max?: number): Promise<AnswerLineage[]>;
}

function evidenceRefs(body: string): string[] {
  const refs: string[] = [];
  for (const match of body.matchAll(CITATION_RE)) {
    const ref = `Log/${match[1]}.md#^${match[2]}`;
    if (!refs.includes(ref)) refs.push(ref);
    if (refs.length >= MAX_EVIDENCE) break;
  }
  return refs;
}

/**
 * Every Markdown file's path, mtime and size, hashed: the tree and everything it reads lazily
 * (page bodies for evidence and citers) depend only on these files (E24-M7). `racy` (as in Git's
 * index): a file changed so close to now that a same-size rewrite could keep its coarse mtime.
 */
async function vaultFingerprint(vaultPath: string): Promise<{ hash: string; racy: boolean }> {
  const takenAt = Date.now();
  const files = await listMarkdownFiles(vaultPath);
  const infos = await Promise.all(files.map((path) => stat(join(vaultPath, path)).catch(() => null)));
  const hash = createHash("sha1");
  let newest = Number.NEGATIVE_INFINITY;
  files.forEach((path, i) => {
    const info = infos[i];
    if (info && info.mtimeMs > newest) newest = info.mtimeMs;
    hash.update(`${path}\0${info?.mtimeMs ?? -1}\0${info?.size ?? -1}\n`);
  });
  return { hash: hash.digest("hex"), racy: newest >= takenAt - RACY_MS };
}

/** Many times a file system's timestamp tick (Linux: a few ms). */
const RACY_MS = 100;
const MAX_CACHED_TREES = 8;
/** Pages read at once when mapping Log entries to the pages citing them. */
const CITER_READ_CONCURRENCY = 16;
const treeCache = new Map<string, { fingerprint: string; racy: boolean; tree: Promise<MemoryTreeIndex> }>();

/**
 * The vault's tree, rebuilt only when a Markdown file was added, removed or changed (E24-M7):
 * building it reads and parses every page one by one, and search_memory asked for it on every
 * call. Same vault files, same tree object, so callers see exactly what a fresh build returns.
 */
export async function loadMemoryTree(vaultPath: string): Promise<MemoryTreeIndex> {
  const key = resolve(vaultPath);
  const { hash, racy } = await vaultFingerprint(vaultPath);
  const cached = treeCache.get(key);
  if (cached && cached.fingerprint === hash && !cached.racy) {
    treeCache.delete(key); treeCache.set(key, cached);
    return cached.tree;
  }
  const tree = buildMemoryTree(vaultPath);
  treeCache.delete(key);
  treeCache.set(key, { fingerprint: hash, racy, tree });
  if (treeCache.size > MAX_CACHED_TREES) treeCache.delete(treeCache.keys().next().value!);
  // A failed build is not kept: the next call tries again.
  tree.catch(() => { if (treeCache.get(key)?.tree === tree) treeCache.delete(key); });
  return tree;
}

/** One tree scan per call; lineage and node queries are answered from it. */
async function buildMemoryTree(vaultPath: string): Promise<MemoryTreeIndex> {
  const index = await buildTreeIndex(vaultPath);
  const evidence = new Map<string, Promise<string[]>>();
  const evidenceOf = (path: string) => {
    if (!evidence.has(path)) {
      evidence.set(path, readFile(join(vaultPath, path), "utf8").then(evidenceRefs, () => []));
    }
    return evidence.get(path)!;
  };
  const exact = (path: string) => (index.fields.has(path) ? path : index.resolveRef(path) ?? path);

  async function lineageOf(path: string): Promise<MemoryLineage> {
    const page = exact(path);
    const found = index.lineage(page);
    const cited = page.startsWith("Log/") ? [] : await evidenceOf(page);
    if (!found.ok) return { placement: "unplaced", lineage: [], evidence: cited };
    return {
      placement: "placed",
      lineage: [
        { path: null, title: GROUP_HEADINGS[found.group], memory: found.group },
        ...found.steps.map((step) => ({ path: step.path, title: step.name, memory: found.group })),
      ],
      evidence: cited,
    };
  }

  async function nodeView(path: string): Promise<MemoryTreeNodeView> {
    const own = await lineageOf(path);
    const group = own.lineage[0]?.memory ?? null;
    const children = index.children(exact(path)).map((child) => {
      const fields = index.fields.get(child);
      return { path: child, title: fields?.title ?? basenameOf(child), memory: group ?? fields?.memory ?? null };
    });
    return { ...own, parent: own.lineage.at(-2) ?? null, children };
  }

  let citers: Promise<Map<string, string[]>> | undefined;
  async function placedCitersOf(evidenceRef: string): Promise<string[]> {
    citers ??= (async () => {
      const map = new Map<string, string[]>();
      const placed = [...index.fields.keys()].filter((path) => index.lineage(path).ok);
      // A few pages at a time (E24-M7: one by one was slow). Read order does not matter: each list
      // is sorted below by depth, then path.
      let next = 0;
      const worker = async () => {
        for (let i = next++; i < placed.length; i = next++) {
          const path = placed[i]!;
          const body = await readFile(join(vaultPath, path), "utf8").catch(() => "");
          for (const match of body.matchAll(CITATION_RE)) {
            const ref = `Log/${match[1]}.md#^${match[2]}`;
            const list = map.get(ref) ?? [];
            if (!list.includes(path)) list.push(path);
            map.set(ref, list);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CITER_READ_CONCURRENCY, placed.length) }, worker));
      // The deepest page is the most specific place the capture was filed.
      const depth = (path: string) => { const found = index.lineage(path); return found.ok ? found.steps.length : 0; };
      for (const list of map.values()) list.sort((a, b) => depth(b) - depth(a) || a.localeCompare(b));
      return map;
    })();
    return (await citers).get(evidenceRef) ?? [];
  }

  async function answerLineage(sources: readonly string[], max = MAX_ANSWER_LINEAGE): Promise<AnswerLineage[]> {
    const out: AnswerLineage[] = [];
    for (const source of sources) {
      if (out.length >= max) break;
      const [base = "", anchor] = source.split("#");
      let page: string | undefined;
      let evidence: string | undefined;
      if (base.startsWith("Log/")) {
        if (!anchor?.startsWith("^e-")) continue;
        evidence = `${base}#${anchor}`;
        page = (await placedCitersOf(evidence))[0];
      } else {
        page = base;
      }
      if (!page || out.some((item) => item.page === page)) continue;
      const found = await lineageOf(page);
      if (found.placement !== "placed") continue;
      const anchored = { ...found, evidence: evidence ? [evidence] : found.evidence };
      out.push({ source, page, lineage: found.lineage, ...(anchored.evidence[0] ? { evidence: anchored.evidence[0] } : {}), text: formatMemoryLineage(anchored) });
    }
    return out;
  }

  return { lineageOf, nodeView, placedCitersOf, answerLineage };
}

const MAX_ANSWER_LINEAGE = 5;

/**
 * Levels 0–1 of the tree as a compact briefing map (E9-3b): one line per root,
 * grouped working / long-term. "" when the vault has no tree or no roots yet.
 */
export function formatTreeBriefing(tree: ParsedTree | null): string {
  if (!tree?.nodes.length) return "";
  const groups = (["working", "long-term"] as const).map((kind) => {
    const nodes = tree.nodes.filter((node) => node.kind === kind);
    if (!nodes.length) return "";
    const label = kind === "working" ? "ongoing now" : "what lasts";
    return [`${GROUP_HEADINGS[kind]} (${label})`, ...nodes.map((node) => `- ${node.name} → ${node.path}: ${node.summary}`)].join("\n");
  });
  return groups.filter(Boolean).join("\n");
}

/** Read `<vault>/Tree.md` and format it for the briefing; "" when absent or unreadable. */
export async function memoryTreeBriefing(vaultPath: string): Promise<string> {
  return formatTreeBriefing(await readTree(vaultPath).catch(() => null));
}

/** `Working memory › Boat repair › 2023 Porto quotes ← Log/2026-10-31.md#^e-c64e3b`; "" when unplaced. */
export function formatMemoryLineage(lineage: MemoryLineage): string {
  if (lineage.placement !== "placed") return "";
  const path = lineage.lineage.map((node) => node.title).join(" › ");
  return lineage.evidence[0] ? `${path} ← ${lineage.evidence[0]}` : path;
}
