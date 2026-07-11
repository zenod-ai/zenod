import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { UnitSkillManifest } from "@zenod/mcp-chassis";

export const ZENOD_SKILL_BUNDLE_PATH =
  "/.well-known/agent-skill-bundle.json";

const ZENOD_SKILL_ROOT = resolve(
  import.meta.dirname,
  "../../../units/zenod/skill/zenod",
);

const ZENOD_SKILL_PATHS = [
  "SKILL.md",
  "references/EXAMPLES.md",
  "references/WORKFLOW.md",
] as const;

export const ZENOD_PUBLISHED_SKILL: UnitSkillManifest = {
  id: "zenod.memory",
  name: "Zenod",
  version: "1.0.0",
  description:
    "Use Zenod as durable, cited memory for exact retrieval, broad recall, artifact ingest, and receipted writes.",
  purpose: "Store and retrieve durable user-controlled memory with citations and receipts.",
  whenToRoute: [
    "Use when the user asks to remember, save, capture, or preserve information.",
    "Use when the user asks what they previously recorded or needs broad cited recall.",
  ],
  tools: [
    "store_memory",
    "search_memory",
    "get_memory",
    "ask_brain",
    "ingest_memory",
    "get_task_result",
  ],
  etiquette: [
    "Treat live tools/list schemas and tool results as authoritative.",
    "Poll accepted write tickets to terminal evidence; never claim a queued write is stored.",
    "Keep synthetic evidence distinct from real user facts and say unknown when citations do not support an attribute.",
  ],
  receiptExpectations: [
    "Durable writes return terminal evidence references, touched pages, a commit SHA, or a loud error.",
    "Asynchronous writes return an accepted ticket that must be polled through get_task_result.",
  ],
  bundleUrl: ZENOD_SKILL_BUNDLE_PATH,
};

export function zenodSkillBundle() {
  return {
    format: "zenod-agent-skill-bundle-v1" as const,
    files: ZENOD_SKILL_PATHS.map((path) => ({
      path,
      contentBase64: readFileSync(resolve(ZENOD_SKILL_ROOT, path)).toString(
        "base64",
      ),
    })),
  };
}
