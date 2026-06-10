#!/usr/bin/env node
import { VERSION } from "./index.js";
import { getNote, NoteNotFoundError } from "./ops/get.js";
import { searchVault } from "./ops/search.js";
import { lintVault } from "./vault/lint.js";
import type { VaultLocation } from "./vault/github.js";

const COMMANDS = ["store", "ask", "chat", "search", "get", "lint"] as const;
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
    "",
    "Environment:",
    "  ZENOD_VAULT_PATH  local vault directory (dev harness for search/get/lint)",
    "  VAULT_REPO        owner/name on GitHub, used for provenance URLs",
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
        if (hit.githubUrl) console.log(`     ${hit.githubUrl}`);
      }
      console.log(`\n${hits.length} result(s) in ${elapsed}ms`);
      return 0;
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
        if (note.githubUrl) console.log(`\nsource: ${note.githubUrl}`);
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

    case "store":
    case "ask":
    case "chat":
      // Wired up phase by phase — see docs/M0-PLAN.md.
      console.error(`zenod ${cmd}: not implemented yet (M0 in progress)`);
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
