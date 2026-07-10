import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  ProofFailure,
  assertNoForeignMarker,
  assertFullModePrerequisites,
  createRecorder,
  extractProvisionedToken,
  parseArgs,
  parseMcpPayload,
  redact,
  requiredCustodyRelativePaths,
  verifyStorage,
} from "./epic32-joint-proof.mjs";

const STORAGE_TENANTS = ["t1", "t2", "t3"].map((tenantId, index) => ({
  tenantId,
  label: `T${index + 1}`,
  issuedTokens: [`fixture-bearer-${index + 1}`],
}));

async function createStorageFixture() {
  const root = await mkdtemp(join(tmpdir(), "epic32-custody-"));
  const databases = [];
  for (const relative of requiredCustodyRelativePaths(STORAGE_TENANTS).filter((path) => path.endsWith(".sqlite"))) {
    const path = join(root, relative);
    await mkdir(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA wal_autocheckpoint = 0; CREATE TABLE smoke (value TEXT); INSERT INTO smoke VALUES ('fixture')");
    databases.push(db);
  }
  for (const tenant of STORAGE_TENANTS) {
    await Promise.all([
      mkdir(join(root, tenant.tenantId, "transcripts"), { recursive: true }),
      mkdir(join(root, tenant.tenantId, "media"), { recursive: true }),
      mkdir(join(root, tenant.tenantId, "vault"), { recursive: true }),
    ]);
  }
  let closed = false;
  return {
    root,
    close() {
      if (closed) return;
      closed = true;
      for (const db of databases) db.close();
    },
    async destroy() {
      this.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

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

test("custody inventory declares exact chassis and per-tenant DB/WAL/SHM paths", () => {
  const paths = requiredCustodyRelativePaths([{ tenantId: "t1" }, { tenantId: "t2" }, { tenantId: "t3" }]);
  assert.deepEqual(paths.slice(0, 6), [
    "chassis-tenants.sqlite",
    "chassis-tenants.sqlite-wal",
    "chassis-tenants.sqlite-shm",
    "usage.sqlite",
    "usage.sqlite-wal",
    "usage.sqlite-shm",
  ]);
  assert.ok(paths.includes("t1/zenod.sqlite-wal"));
  assert.ok(paths.includes("t2/vault.sqlite-shm"));
  assert.ok(paths.includes("t3/notifications.sqlite"));
  assert.equal(paths.length, 96);
  assert.equal(new Set(paths).size, paths.length);
});

test("verifyStorage emits exact zero-match DB/WAL/SHM and recursive custody receipts", async () => {
  const fixture = await createStorageFixture();
  try {
    const receipt = await verifyStorage(fixture.root, STORAGE_TENANTS, "full", [
      { label: "test world credential", value: "fixture-world-secret" },
    ]);
    assert.equal(receipt.custodyPaths.length, 96);
    assert.deepEqual(new Set(receipt.custodyPaths.map((entry) => entry.kind)), new Set(["database", "wal", "shm"]));
    assert.ok(receipt.custodyPaths.every((entry) => entry.rawMatches === 0 && entry.scannedSecrets === 4));
    assert.equal(receipt.recursiveScan.scannedSecrets, 4);
    assert.equal(receipt.recursiveScan.rawMatches, 0);
    assert.ok(receipt.recursiveScan.scannedPaths >= 96);
  } finally {
    await fixture.destroy();
  }
});

test("verifyStorage fails when declared WAL/SHM custody paths are absent", async () => {
  const fixture = await createStorageFixture();
  fixture.close();
  try {
    await assert.rejects(
      verifyStorage(fixture.root, STORAGE_TENANTS, "full"),
      (error) =>
        error instanceof ProofFailure &&
        error.detail.violations.some((violation) => violation.includes("custody scan missing required DB/WAL/SHM path")),
    );
  } finally {
    await fixture.destroy();
  }
});

test("verifyStorage fails on an injected raw world credential", async () => {
  const fixture = await createStorageFixture();
  const secret = "fixture-injected-world-secret";
  try {
    await writeFile(join(fixture.root, "t1", "media", "injected.bin"), secret, "utf8");
    await assert.rejects(
      verifyStorage(fixture.root, STORAGE_TENANTS, "full", [{ label: "injected world credential", value: secret }]),
      (error) =>
        error instanceof ProofFailure &&
        error.detail.violations.some((violation) => violation.includes("raw injected world credential persisted")),
    );
  } finally {
    await fixture.destroy();
  }
});

test("proof summaries retain exact commit and immutable image digest", () => {
  const metadata = {
    commit: "c".repeat(40),
    imageDigest: `sha256:${"d".repeat(64)}`,
  };
  const summary = createRecorder(metadata).summary("pass");
  assert.equal(summary.commit, metadata.commit);
  assert.equal(summary.imageDigest, metadata.imageDigest);
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
    EPIC32_COMMIT: "a".repeat(40),
    EPIC32_IMAGE_DIGEST: `sha256:${"b".repeat(64)}`,
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
    () => assertFullModePrerequisites(options, tenants, { ...env, EPIC32_COMMIT: "unknown" }),
    /EPIC32_COMMIT/,
  );
  assert.throws(
    () => assertFullModePrerequisites(options, tenants, { ...env, EPIC32_IMAGE_DIGEST: "latest" }),
    /EPIC32_IMAGE_DIGEST/,
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
