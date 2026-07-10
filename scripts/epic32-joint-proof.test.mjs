import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ProofFailure,
  assertNoForeignMarker,
  assertFullModePrerequisites,
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

test("redact removes arbitrary MCP bearer paths from error text", () => {
  const secret = "arbitrary-path-token-value";
  const output = redact(`request failed for http://localhost:8080/mcp/${secret}?debug=1`);
  assert.doesNotMatch(output, new RegExp(secret));
  assert.match(output, /\/mcp\/\[redacted\]/);
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

test("redact preserves numeric usage evidence while removing raw credentials", () => {
  assert.deepEqual(
    redact({ inputTokens: 123, outputTokens: 45, token: "raw-token", openrouter_api_key: "raw-key" }),
    { inputTokens: 123, outputTokens: 45, token: "[redacted]", openrouter_api_key: "[redacted]" },
  );
});

test("full mode accepts only the three approved repos and complete parity inputs", () => {
  const options = {
    mode: "full",
    baseUrl: "http://hosted:8080",
    dataRoot: "/data",
    selfHostUrl: "http://self:8080",
    selfHostToken: "self-token",
    migratedUrl: "http://migrated:8080",
    migratedToken: "migrated-token",
  };
  const githubToken = "github-token";
  const tenants = [
    { repo: "AlfaBlok/test_evals", githubToken },
    { repo: "AlfaBlok/react_test1", githubToken },
    { repo: "AlfaBlok/zenod-cloud-test-vault-4ptjqj", githubToken },
  ];
  const env = {
    EPIC32_GITHUB_TOKEN: githubToken,
    EPIC32_LLM_API_KEY: "llm-key",
    CHASSIS_VAULT_MASTER_KEY: "11".repeat(32),
    EPIC32_SELF_HOST_REPO: tenants[2].repo,
    EPIC32_MIGRATED_REPO: tenants[1].repo,
    EPIC32_MIGRATED_EXPECTED_TOKEN_SHA256: createHash("sha256").update(options.migratedToken).digest("hex"),
  };
  assert.doesNotThrow(() => assertFullModePrerequisites(options, tenants, env));
  assert.throws(
    () => assertFullModePrerequisites(options, [{ repo: "fake/repo" }, ...tenants.slice(1)], env),
    /exact approved repositories/,
  );
  assert.throws(
    () => assertFullModePrerequisites(options, tenants, { ...env, CHASSIS_VAULT_MASTER_KEY: "" }),
    /CHASSIS_VAULT_MASTER_KEY/,
  );
  assert.throws(
    () => assertFullModePrerequisites({ ...options, dataRoot: "" }, tenants, env),
    /EPIC32_DATA_ROOT/,
  );
  assert.throws(
    () => assertFullModePrerequisites({ ...options, migratedUrl: options.baseUrl }, tenants, env),
    /distinct hosted, self-host, and migrated endpoints/,
  );
  assert.throws(
    () => assertFullModePrerequisites({ ...options, selfHostUrl: "http://HOSTED:8080/" }, tenants, env),
    /distinct hosted, self-host, and migrated endpoints/,
  );
  assert.throws(
    () =>
      assertFullModePrerequisites(options, [{ ...tenants[0], githubToken: "different" }, ...tenants.slice(1)], env),
    /one approved EPIC32_GITHUB_TOKEN/,
  );
});
