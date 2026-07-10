import assert from "node:assert/strict";
import test from "node:test";

import {
  ProofFailure,
  assertNoForeignMarker,
  extractProvisionedToken,
  parseArgs,
  parseMcpPayload,
  redact,
} from "./epic32-joint-proof.mjs";

test("parseArgs accepts CLI overrides without reading secrets into defaults", () => {
  const options = parseArgs(
    ["--base-url", "http://localhost:9090/", "--control-token", "control", "--mode", "full", "--run-id", "proof-1"],
    {},
  );
  assert.equal(options.baseUrl, "http://localhost:9090/");
  assert.equal(options.controlToken, "control");
  assert.equal(options.mode, "full");
  assert.equal(options.runId, "proof-1");
});

test("parseArgs rejects unsupported proof modes", () => {
  assert.throws(() => parseArgs(["--mode", "hopeful"], {}), (error) => error instanceof ProofFailure && error.kind === "usage");
});

test("parseMcpPayload handles JSON and streamable HTTP SSE", () => {
  assert.deepEqual(parseMcpPayload('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'), {
    jsonrpc: "2.0",
    id: 1,
    result: { ok: true },
  });
  assert.deepEqual(
    parseMcpPayload('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n', "text/event-stream"),
    { jsonrpc: "2.0", id: 1, result: { tools: [] } },
  );
});

test("redact removes nested credentials and bearer strings", () => {
  const output = redact({
    token: "zenod_abcdefghijklmnopqrstuvwxyz123456",
    nested: { github_token: "ghp_abcdef", message: "Authorization: Bearer top-secret" },
  });
  assert.equal(output.token, "[redacted]");
  assert.equal(output.nested.github_token, "[redacted]");
  assert.doesNotMatch(JSON.stringify(output), /top-secret|ghp_abcdef|abcdefghijklmnopqrstuvwxyz/);
});

test("assertNoForeignMarker accepts own-only results and rejects a tenant leak", () => {
  assert.doesNotThrow(() => assertNoForeignMarker({ hits: [{ text: "T1_MARKER" }] }, "T1_MARKER", ["T2_MARKER"]));
  assert.throws(() => assertNoForeignMarker({ hits: [{ text: "T2_MARKER" }] }, "", ["T2_MARKER"]), /cross-tenant marker leaked/);
});

test("extractProvisionedToken tolerates chassis response shapes", () => {
  assert.equal(extractProvisionedToken({ token: "one" }), "one");
  assert.equal(extractProvisionedToken({ rawToken: "two" }), "two");
  assert.equal(extractProvisionedToken({ tenant: { token: "three" } }), "three");
  assert.equal(extractProvisionedToken({ tenant: { tenantId: "t1" } }), null);
});

test("redact preserves non-secret credential hashes as proof handles", () => {
  const output = redact({
    retiredCredentialSha256: "retired-hash",
    activeCredentialSha256: "active-hash",
  });
  assert.deepEqual(output, {
    retiredCredentialSha256: "retired-hash",
    activeCredentialSha256: "active-hash",
  });
});
