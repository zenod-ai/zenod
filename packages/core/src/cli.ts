#!/usr/bin/env node
import { VERSION } from "./index.js";

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
    "  lint            validate the vault against the schema",
  ].join("\n");
}

const [, , cmd, ..._args] = process.argv;

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(usage());
  process.exit(0);
}

if (cmd === "--version" || cmd === "-v") {
  console.log(VERSION);
  process.exit(0);
}

if (!COMMANDS.includes(cmd as Command)) {
  console.error(`Unknown command: ${cmd}\n\n${usage()}`);
  process.exit(1);
}

// Wired up phase by phase — see docs/M0-PLAN.md.
console.error(`zenod ${cmd}: not implemented yet (M0 in progress)`);
process.exit(1);
