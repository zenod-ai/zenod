import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadRegistry,
  bundleTool,
  bundleAll,
  assertSelfContained,
  collectDefRefs,
  WRITE_TOOLS,
} from "./build-tool-output-schemas.mjs";

const registry = loadRegistry();

// Pull the allowed evidence `kind` consts out of an emitted per-tool schema.
function allowedKinds(schema) {
  const items = schema.properties.evidence.items;
  const refs = [...collectDefRefs(items)];
  // If evidence.items references the generic EvidenceObject union (passthrough),
  // expand it to every variant.
  const expand = (name) =>
    name === "EvidenceObject"
      ? [...collectDefRefs(schema.$defs.EvidenceObject)]
      : [name];
  const evNames = refs.flatMap(expand);
  return new Set(
    evNames
      .map((n) => schema.$defs[n]?.properties?.kind?.const)
      .filter(Boolean)
  );
}

test("every emitted per-tool schema is self-contained (no dangling $defs refs)", () => {
  const bundles = bundleAll(registry);
  assert.equal(Object.keys(bundles).length, Object.keys(registry.tools).length);
  for (const [tool, schema] of Object.entries(bundles)) {
    assert.doesNotThrow(() => assertSelfContained(schema, tool));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.deepEqual(schema.required, ["evidence"]);
    assert.equal(schema.additionalProperties, false);
  }
});

test("get_issue narrows evidence to exactly `issue`", () => {
  const s = bundleTool("archus.get_issue", registry);
  assert.deepEqual([...allowedKinds(s)], ["issue"]);
  assert.ok(s.$defs.Ev_issue, "Ev_issue bundled");
  assert.ok(!s.$defs.Ev_memory_stored, "unrelated variant not bundled");
});

test("run_issue allows only execution_queued / execution_blocked", () => {
  const kinds = allowedKinds(bundleTool("archus.run_issue", registry));
  assert.deepEqual(new Set(kinds), new Set(["execution_queued", "execution_blocked"]));
});

test("outbound channels do not leak across tools", () => {
  const email = allowedKinds(bundleTool("outbound.send_email", registry));
  assert.ok(email.has("outbound_email_sent"));
  assert.ok(!email.has("outbound_tweet_sent"));
});

test("ask_archus allows issue_not_found (it may perform reads)", () => {
  const kinds = allowedKinds(bundleTool("archus.ask_archus", registry));
  assert.ok(kinds.has("issue_not_found"));
});

test("write tools require currentState on errors; reads do not", () => {
  for (const tool of WRITE_TOOLS) {
    const s = bundleTool(tool, registry);
    const errItem = s.properties.errors.items;
    const ref = errItem.$ref?.split("/").pop();
    assert.equal(ref, "ToolErrorWrite", `${tool} errors -> ToolErrorWrite`);
    assert.ok(
      s.$defs.ToolErrorWrite.required.includes("currentState"),
      `${tool} ToolErrorWrite requires currentState`
    );
  }
  const read = bundleTool("archus.get_issue", registry);
  assert.ok(!(read.$defs.ToolError.required ?? []).includes("currentState"));
});

test("console passthrough keeps the full evidence union", () => {
  const kinds = allowedKinds(bundleTool("console.chat_with_console", registry));
  // Should include kinds from several domains, not a single narrowed set.
  for (const k of ["issue_created", "execution_queued", "notification_sent", "memory_stored"]) {
    assert.ok(kinds.has(k), `passthrough includes ${k}`);
  }
});
