#!/usr/bin/env node
import { dirname, join } from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { simpleGit } from "simple-git";
import { VERSION } from "./index.js";
import { getNote, NoteNotFoundError } from "./ops/get.js";
import { searchVault } from "./ops/search.js";
import { lintVault } from "./vault/lint.js";
import { lintTree } from "./vault/treeLint.js";
import { AUDIT_TREE_PROPOSAL, seedTreeFiles } from "./vault/treeSeed.js";
import { buildTreeIndex, formatLineage } from "./vault/tree.js";
import type { VaultLocation } from "./vault/github.js";
import { createEngine } from "./engine/engine.js";
import { discoverTree } from "./engine/treeDiscover.js";
import { rediscoverTree, refileAgentLeaves } from "./engine/treeSweep.js";
import { TrackedWrites } from "./engine/treePlacement.js";
import { ensureSchemaV1 } from "./vault/migrate.js";
import { cleanSlateVault, type CleanSlateResult } from "./vault/cleanSlate.js";
import { VaultRepo } from "./git/vaultRepo.js";
import { createBrainLlm, type Provider } from "./llm/aisdk.js";
import { SqliteStateStore } from "./state/sqlite.js";
import { MemoryIndex } from "./vault/memoryIndex.js";
import type { BrainEngine } from "./types.js";

const COMMANDS = ["store", "ask", "chat", "search", "get", "lint", "tree", "index", "clean-slate"] as const;
type Command = (typeof COMMANDS)[number];

function usage(): string {
  return [
    `zenod ${VERSION} — self-hosted AI memory agent (https://github.com/zenod-ai/zenod)`,
    "",
    "Usage: zenod <command> [args]",
    "",
    "Commands:",
    "  store <text>    file a memory through the librarian pipeline",
    "  ask <question>  synthesized answer with citations (read-only)",
    "  chat <message>  conversational turn with memory",
    "  search <query>  deterministic search, no LLM",
    "  get <path>      fetch one note, no LLM",
    "  lint [paths..]  validate the vault against the schema",
    "  tree lint [--json]        check the memory tree (parents, Tree.md roots, cycles, depth, duplicate titles)",
    "  tree lineage <path>       print a page's path root → leaf",
    "  tree seed [--out <dir>] [--date YYYY-MM-DD]  print the audit's proposed Tree.md, or write Tree.md + root pages into <dir>",
    "  tree discover [--apply] [--fresh] [--today YYYY-MM-DD] [--json]  find the roots from content and your recent captures; --apply rewrites Tree.md and parent:/memory: lines (no commit)",
    "  index rebuild             rebuild the tier-0 memory index (SQLite FTS5 beside the vault) from scratch; idempotent",
    "  index search <query>      query the tier-0 index (refreshes changed files first), with tree paths and timing",
    "  index stats               rows, files and size of the tier-0 index",
    "  clean-slate <path> [--push]  initialize an empty vault in two commits",
    "",
    "Environment:",
    "  ZENOD_VAULT_PATH  local vault directory (dev harness for search/get/lint)",
    "  VAULT_REPO        owner/name on GitHub, used for provenance URLs",
    "  ZENOD_DATA_DIR    data dir; `index` defaults to <dir>/vault and <dir>/memory-index.sqlite",
    "  ZENOD_MEMORY_INDEX  index file override for `index`",
  ].join("\n");
}

function formatCleanSlate(result: CleanSlateResult): string {
  return [
    `vault: ${result.vaultPath}`,
    `branch: ${result.branch}`,
    `initial commit: ${result.initialCommitSha}`,
    `setup commit: ${result.setupCommitSha}`,
    `top-level: ${result.topLevelPaths.join(", ")}`,
    `lint: ${result.lint.ok ? "ok" : `${result.lint.errors.length} error(s)`}`,
    "",
    "inspect:",
    ...result.inspect.map((cmd) => `  ${cmd}`),
    "",
    "revert:",
    ...result.revert.map((cmd) => `  ${cmd}`),
    ...result.githubUrls.map((url) => `\n${url}`),
  ].join("\n");
}

function vaultPath(): string {
  const path = process.env.ZENOD_VAULT_PATH;
  if (!path) {
    console.error("ZENOD_VAULT_PATH is not set — point it at a local vault directory");
    process.exit(2);
  }
  return path;
}

function location(): VaultLocation {
  const repo = process.env.VAULT_REPO;
  return repo ? { repo, branch: process.env.VAULT_BRANCH ?? "main" } : {};
}

/** Full engine bootstrap from env — used by store/ask/chat. */
async function buildEngine(): Promise<BrainEngine> {
  const provider: Provider = process.env.ZENOD_PROVIDER === "openai" ? "openai" : "anthropic";
  const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  const repoName = process.env.VAULT_REPO;
  if (!apiKey || !repoName) {
    const keyVar = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    console.error(`store/ask/chat need ${keyVar} and VAULT_REPO (and GITHUB_TOKEN to push)`);
    process.exit(2);
  }
  const dataDir = process.env.ZENOD_DATA_DIR ?? join(process.env.HOME ?? ".", ".zenod");
  const repo = await VaultRepo.open({
    workdir: process.env.ZENOD_WORKDIR ?? join(dataDir, "vault"),
    repo: repoName,
    ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
  });
  const created = await ensureSchemaV1(repo.path);
  if (created.length > 0) await repo.commitAndPush(`schema: v1 — add ${created.join(", ")}`);
  const llm = createBrainLlm({
    provider,
    apiKey,
    ...(process.env.ZENOD_MODEL_ASK ? { askModel: process.env.ZENOD_MODEL_ASK } : {}),
    ...(process.env.ZENOD_MODEL_CLASSIFY ? { classifyModel: process.env.ZENOD_MODEL_CLASSIFY } : {}),
  });
  const state = new SqliteStateStore(join(dataDir, "state.sqlite"));
  return createEngine({ repo, llm, state, location: location(), memoryIndex: { path: join(dataDir, "memory-index.sqlite"), tenantId: "standalone" } });
}

async function main(): Promise<number> {
  const [, , cmd, ...args] = process.argv;

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(usage());
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return 0;
  }
  if (!COMMANDS.includes(cmd as Command)) {
    console.error(`Unknown command: ${cmd}\n\n${usage()}`);
    return 1;
  }

  switch (cmd as Command) {
    case "search": {
      const query = args.join(" ").trim();
      if (!query) {
        console.error("usage: zenod search <query>");
        return 1;
      }
      const started = performance.now();
      const hits = await searchVault(vaultPath(), query, location());
      const elapsed = Math.round(performance.now() - started);
      if (hits.length === 0) {
        console.log(`no results (${elapsed}ms)`);
        return 0;
      }
      for (const hit of hits) {
        console.log(`${hit.score.toString().padStart(3)}  ${hit.path}${hit.snippet ? `  — ${hit.snippet}` : ""}`);
        if (hit.url) console.log(`     ${hit.url}`);
      }
      console.log(`\n${hits.length} result(s) in ${elapsed}ms`);
      return 0;
    }

    case "index": {
      // The index lives beside the vault in the data dir, never inside the vault (E9-A6).
      const dataDir = process.env.ZENOD_DATA_DIR ?? join(process.env.HOME ?? ".", ".zenod");
      const vault = process.env.ZENOD_VAULT_PATH ?? join(dataDir, "vault");
      const index = MemoryIndex.open({ path: process.env.ZENOD_MEMORY_INDEX ?? join(dataDir, "memory-index.sqlite"), vaultPath: vault });
      try {
        const [sub, ...rest] = args;
        if (sub === "rebuild") {
          const stats = await index.rebuild();
          console.log(`rebuilt tenant ${index.tenantId}: ${stats.rows} rows from ${stats.files} files, ${stats.bytes} bytes, ${stats.ms}ms`);
          return 0;
        }
        if (sub === "stats") {
          const stats = index.stats();
          console.log(`tenant ${index.tenantId}: ${stats.rows} rows from ${stats.files} files, ${stats.bytes} bytes`);
          return 0;
        }
        if (sub === "search" && rest.join(" ").trim()) {
          await index.refresh();
          const started = performance.now();
          const hits = await index.search(rest.join(" ").trim());
          const elapsed = (performance.now() - started).toFixed(1);
          for (const hit of hits) {
            console.log(`${hit.score.toFixed(2).padStart(7)}  ${hit.path}${hit.treePath ? `  [${hit.treePath}]` : ""}${hit.snippet ? `  — ${hit.snippet}` : ""}`);
          }
          console.log(`\n${hits.length} result(s) in ${elapsed}ms`);
          return 0;
        }
        console.error("usage: zenod index rebuild | zenod index stats | zenod index search <query>");
        return 1;
      } finally {
        index.close();
      }
    }

    case "get": {
      const path = args[0];
      if (!path) {
        console.error("usage: zenod get <vault-relative-path>");
        return 1;
      }
      try {
        const note = await getNote(vaultPath(), path, location());
        if (Object.keys(note.frontmatter).length > 0) {
          console.log(`--- ${JSON.stringify(note.frontmatter)}\n`);
        }
        console.log(note.body);
        if (note.url) console.log(`\nsource: ${note.url}`);
        return 0;
      } catch (err) {
        if (err instanceof NoteNotFoundError) {
          console.error(err.message);
          return 1;
        }
        throw err;
      }
    }

    case "lint": {
      const report = await lintVault(vaultPath(), args.length > 0 ? args : undefined);
      for (const error of report.errors) {
        console.error(`${error.path}${error.line ? `:${error.line}` : ""}  [${error.rule}]  ${error.message}`);
      }
      console.log(`${report.ok ? "ok" : `${report.errors.length} error(s)`} — ${report.checkedFiles} file(s) checked`);
      return report.ok ? 0 : 1;
    }

    case "tree": {
      const [sub, ...rest] = args;
      if (sub === "lint") {
        const report = await lintTree(vaultPath());
        if (rest.includes("--json")) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          for (const issue of report.issues) {
            console.error(`${issue.path}${issue.line ? `:${issue.line}` : ""}  [${issue.rule}]  ${issue.severity === "warning" ? "warning: " : ""}${issue.message}`);
          }
          const s = report.stats;
          console.log([
            `tree pages ${s.treePages} · rooted ${s.rooted} · roots working ${s.rootNodes.working} / long-term ${s.rootNodes["long-term"]}`,
            `without parent ${s.withoutParent} · unresolved parent ${s.unresolvedParent} · parent not in Tree.md ${s.parentNotInTree} · cycles ${s.cycles} · too deep ${s.tooDeep} · memory mismatch ${s.memoryMismatch}`,
            `duplicate titles ${s.duplicateTitleGroups} group(s) / ${s.duplicateTitlePages} page(s) · Inbox machine files ${s.inboxMachineFiles} · outside schema ${s.outsideSchema}`,
            report.ok ? "ok" : `${report.issues.filter(i => i.severity === "error").length} error(s)`,
          ].join("\n"));
        }
        return report.ok ? 0 : 1;
      }
      if (sub === "lineage" && rest[0]) {
        const result = (await buildTreeIndex(vaultPath())).lineage(rest[0]);
        if (!result.ok) {
          console.error(`${rest[0]}: ${result.reason} at ${result.at}`);
          return 1;
        }
        console.log(formatLineage(result));
        return 0;
      }
      if (sub === "discover") {
        const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
        const today = flag("--today") ?? new Date().toISOString().slice(0, 10);
        const plan = await discoverTree(vaultPath(), { today, ...(rest.includes("--fresh") ? { fresh: true } : {}) });
        if (!plan) {
          console.error("vault has no Tree.md; discovery only re-roots an existing tree");
          return 1;
        }
        // --apply first moves agent-report leaves to the ops rollup (E9-2h), then runs to a fixed point, as the weekly sweep does.
        const writes = rest.includes("--apply") ? new TrackedWrites(vaultPath()) : null;
        const refiled = writes ? await refileAgentLeaves(vaultPath(), writes) : [];
        const applied = writes ? await rediscoverTree(vaultPath(), today, writes, rest.includes("--fresh")) : null;
        const changed = writes ? writes.paths.sort() : null;
        const roots = applied?.roots ?? plan.roots;
        if (rest.includes("--json")) {
          console.log(JSON.stringify({ fresh: plan.fresh, stats: plan.stats, roots, changed, agentLeavesRefiled: refiled.length, subjects: applied?.subjects ?? [] }, null, 2));
          return 0;
        }
        for (const root of roots) {
          console.log(`${root.kind.padEnd(9)}  ${root.name}  ·  ${root.pages} page(s) · heat ${root.heat} · own captures 30d ${root.ownCaptures}${root.continues ? "" : " · new"}`);
        }
        for (const subject of applied?.subjects ?? []) console.log(`subject    ${subject.display}  ·  ${subject.created ? "new page" : `${subject.added} new capture(s) on`} ${subject.path}`);
        console.log(`${plan.stats.pages} tree pages · ${plan.stats.topics} topics · ${plan.fresh ? "fresh (current roots ignored)" : "continuing"}${changed ? ` · ${changed.length} file(s) written · ${refiled.length} agent-report leaf(s) moved to the ops rollup` : " · dry run"}`);
        return 0;
      }
      if (sub === "seed") {
        const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
        const files = seedTreeFiles(AUDIT_TREE_PROPOSAL, flag("--date"));
        const out = flag("--out");
        if (!out) {
          process.stdout.write(files[0]!.content);
          return 0;
        }
        for (const file of files) {
          const target = join(out, file.path);
          if (await access(target).then(() => true, () => false)) {
            console.error(`${target} already exists; seed never overwrites`);
            return 1;
          }
        }
        for (const file of files) {
          await mkdir(dirname(join(out, file.path)), { recursive: true });
          await writeFile(join(out, file.path), file.content, { flag: "wx" });
          console.log(`wrote ${join(out, file.path)}`);
        }
        return 0;
      }
      console.error(usage());
      return 2;
    }

    case "clean-slate": {
      const push = args.includes("--push");
      const path = args.find((arg) => !arg.startsWith("--")) ?? process.env.ZENOD_VAULT_PATH;
      if (!path) {
        console.error("usage: zenod clean-slate <path> [--push]");
        return 1;
      }
      await mkdir(path, { recursive: true });
      const hasGit = await simpleGit(path).checkIsRepo().catch(() => false);
      if (!hasGit) await simpleGit(path).init(["--initial-branch=main"]);
      const repo = await VaultRepo.open({
        workdir: path,
        ...(process.env.VAULT_REPO ? { repo: process.env.VAULT_REPO } : {}),
        ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
      });
      const result = await cleanSlateVault(repo, { push, location: location() });
      console.log(formatCleanSlate(result));
      return result.lint.ok ? 0 : 1;
    }

    case "store": {
      const content = args.join(" ").trim();
      if (!content) {
        console.error("usage: zenod store <text>");
        return 1;
      }
      const engine = await buildEngine();
      const result = await engine.store({ content, source: "cli" });
      if (result.filing === "uncertain") {
        console.log(`Saved — filed to ${result.pagesTouched[0] ?? "the selected page"} with an open filing question logged in the page (review anytime).`);
      } else if (result.filing === "inbox") {
        console.log("Saved — filed to Inbox; the filing question is logged in the note.");
      } else {
        console.log(result.filing === "pending" ? "Filing pending." : "Saved.");
      }
      console.log(`evidence: ${result.evidenceRef}`);
      for (const page of result.pagesTouched) console.log(`filed: ${page}`);
      if (result.revision) console.log(`saved revision: ${result.revision.provider}:${result.revision.id}`);
      else if (result.commitSha) console.log(`commit: ${result.commitSha}`);
      for (const url of result.urls ?? result.githubUrls ?? []) console.log(url);
      return 0;
    }

    case "ask": {
      const question = args.join(" ").trim();
      if (!question) {
        console.error("usage: zenod ask <question>");
        return 1;
      }
      const engine = await buildEngine();
      const answer = await engine.ask(question);
      console.log(answer.text);
      if (answer.sources.length > 0) {
        console.log("\nSources:");
        for (const s of answer.sources) console.log(`- ${s.path}${s.url ? `  ${s.url}` : ""}`);
      }
      return 0;
    }

    case "chat": {
      const message = args.join(" ").trim();
      if (!message) {
        console.error("usage: zenod chat <message>");
        return 1;
      }
      const engine = await buildEngine();
      const reply = await engine.chat(message, "cli");
      console.log(reply.text);
      if (reply.stored) console.log(`\n(stored: ${reply.stored.evidenceRef})`);
      return 0;
    }
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
