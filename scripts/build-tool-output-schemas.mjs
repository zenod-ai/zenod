#!/usr/bin/env node
// Build step: turn the shared tool-output schema *registry* into one fully
// self-contained JSON Schema per tool, suitable for use directly as that tool's
// MCP `outputSchema`.
//
// Why this exists: in docs/tool-output-schemas.v4.json the per-tool entries use
// `$ref: "#/$defs/..."` that resolve against the document root. If you copy a
// single entry into MCP as-is, those refs dangle. This script flattens each tool
// into a standalone schema whose `$defs` contains exactly the transitive closure
// of definitions it needs (and nothing else).
//
// It also strengthens write tools: their `errors[]` entries must include
// `currentState` (the global ToolError leaves it optional, which is correct for
// reads). The set of write tools lives here as packaging metadata.
//
// Usage:
//   node scripts/build-tool-output-schemas.mjs            # writes dist/tool-output-schemas/*.json
//   node scripts/build-tool-output-schemas.mjs --check    # build in memory, assert self-containment, write nothing

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const REGISTRY_PATH = join(REPO_ROOT, "docs", "tool-output-schemas.v4.json");
const OUT_DIR = join(REPO_ROOT, "dist", "tool-output-schemas");
const SERVER_MODULE_PATH = join(REPO_ROOT, "packages", "server", "src", "toolOutputSchemas.generated.ts");
const SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

// Tools that perform a mutation. Their error objects must carry `currentState`.
export const WRITE_TOOLS = new Set([
  "archus.request_backlog_action",
  "archus.run_issue",
  "outbound.post_tweet",
  "outbound.post_reddit",
  "outbound.send_email",
]);

const TOOL_ERROR_WRITE = {
  type: "object",
  required: ["code", "message", "currentState"],
  properties: {
    operationId: { type: "string" },
    code: { type: "string" },
    message: { type: "string" },
    currentState: { type: "object" },
  },
  additionalProperties: false,
};

export function loadRegistry(path = REGISTRY_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Collect every "#/$defs/NAME" reference reachable from a node.
export function collectDefRefs(node, acc = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectDefRefs(item, acc);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") {
        const m = v.match(/^#\/\$defs\/(.+)$/);
        if (m) acc.add(m[1]);
      } else {
        collectDefRefs(v, acc);
      }
    }
  }
  return acc;
}

// Transitive closure of the defs needed by `root`, drawing from `registryDefs`
// plus any `extraDefs` injected at build time (e.g. ToolErrorWrite).
function closeOverDefs(root, registryDefs, extraDefs) {
  const out = {};
  const seen = new Set();
  const work = [...collectDefRefs(root)];
  while (work.length) {
    const name = work.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const def = extraDefs[name] ?? registryDefs[name];
    if (!def) throw new Error(`registry is missing $defs/${name}`);
    out[name] = def;
    for (const ref of collectDefRefs(def)) if (!seen.has(ref)) work.push(ref);
  }
  return out;
}

// Flatten one tool entry (Envelope + its narrowing) into a standalone schema.
export function bundleTool(toolName, registry) {
  const registryDefs = registry.$defs;
  const entry = registry.tools[toolName];
  if (!entry) throw new Error(`unknown tool: ${toolName}`);

  // Start from the Envelope's properties, then apply the tool's per-property
  // narrowing (evidence.items, etc.) taken from the allOf override branch.
  const props = structuredClone(registryDefs.Envelope.properties);
  if (Array.isArray(entry.allOf)) {
    for (const branch of entry.allOf) {
      if (branch && branch.properties) {
        for (const [k, v] of Object.entries(branch.properties)) {
          props[k] = { ...(props[k] ?? {}), ...v };
        }
      }
    }
  }
  // console.chat_with_console is a bare {$ref: Envelope} passthrough -> keep the
  // generic evidence union (props already cloned from Envelope).

  const extraDefs = {};
  if (WRITE_TOOLS.has(toolName)) {
    props.errors = { ...(props.errors ?? {}), items: { $ref: "#/$defs/ToolErrorWrite" } };
    extraDefs.ToolErrorWrite = TOOL_ERROR_WRITE;
  }

  const body = {
    type: "object",
    required: ["evidence"],
    additionalProperties: false,
    properties: props,
  };

  return {
    $schema: SCHEMA_DIALECT,
    $id: `https://zenod.dev/schemas/tool-output/${toolName}.json`,
    title: `${toolName} output`,
    ...body,
    $defs: closeOverDefs(body, registryDefs, extraDefs),
  };
}

// Assert an emitted schema has no dangling "#/$defs/..." refs.
export function assertSelfContained(schema, label = schema.$id) {
  const provided = new Set(Object.keys(schema.$defs ?? {}));
  // Refs inside body (excluding the $defs block itself).
  const { $defs, ...body } = schema;
  const needed = collectDefRefs(body);
  for (const def of Object.values($defs ?? {})) collectDefRefs(def, needed);
  const missing = [...needed].filter((n) => !provided.has(n));
  if (missing.length) throw new Error(`${label} has dangling refs: ${missing.join(", ")}`);
  return true;
}

export function bundleAll(registry = loadRegistry()) {
  const out = {};
  for (const toolName of Object.keys(registry.tools)) {
    const schema = bundleTool(toolName, registry);
    assertSelfContained(schema, toolName);
    out[toolName] = schema;
  }
  return out;
}

export function generatedServerModule(bundles = bundleAll()) {
  return [
    "// Generated by scripts/build-tool-output-schemas.mjs. Do not edit by hand.",
    "",
    "// prettier-ignore",
    "export const TOOL_OUTPUT_SCHEMAS = (",
    JSON.stringify(bundles, null, 2),
    ") as const;",
    "",
    "export type ToolOutputSchemaName = keyof typeof TOOL_OUTPUT_SCHEMAS;",
    "",
  ].join("\n");
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const bundles = bundleAll();
  if (checkOnly) {
    const expectedModule = generatedServerModule(bundles);
    if (!existsSync(SERVER_MODULE_PATH)) {
      throw new Error(`${SERVER_MODULE_PATH.replace(REPO_ROOT + "/", "")} is missing; run npm run schemas:build`);
    }
    const actualModule = readFileSync(SERVER_MODULE_PATH, "utf8");
    if (actualModule !== expectedModule) {
      throw new Error(`${SERVER_MODULE_PATH.replace(REPO_ROOT + "/", "")} is stale; run npm run schemas:build`);
    }
    console.log(`OK: ${Object.keys(bundles).length} per-tool schemas bundled and self-contained (no files written).`);
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  // Best-effort prune of stale schemas (tools removed from the registry), then
  // overwrite. Avoids a destructive recursive rmSync of the whole directory.
  const wanted = new Set(Object.keys(bundles).map((t) => `${t}.json`));
  try {
    for (const f of readdirSync(OUT_DIR)) {
      if (f.endsWith(".json") && !wanted.has(f)) {
        try { rmSync(join(OUT_DIR, f), { force: true }); } catch { /* ignore */ }
      }
    }
  } catch { /* dir may not exist yet */ }
  for (const [toolName, schema] of Object.entries(bundles)) {
    writeFileSync(join(OUT_DIR, `${toolName}.json`), JSON.stringify(schema, null, 2) + "\n");
  }
  writeFileSync(SERVER_MODULE_PATH, generatedServerModule(bundles));
  console.log(`Wrote ${Object.keys(bundles).length} schemas to ${OUT_DIR.replace(REPO_ROOT + "/", "")}/ and ${SERVER_MODULE_PATH.replace(REPO_ROOT + "/", "")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
