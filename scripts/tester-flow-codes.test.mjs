import assert from "node:assert/strict";
import { test } from "node:test";
import { codeFromIssueOutput, drain, parseArgs } from "./tester-flow-codes.mjs";

test("reads the code from the tester-code command's issue line", () => {
  assert.equal(codeFromIssueOutput("label=zenod-tester-1  code=ZT-ABCDEFGH  promotion_code=promo_1  created=x"), "ZT-ABCDEFGH");
  assert.equal(codeFromIssueOutput("nothing here"), null);
});

test("asks for waiting ids, issues one code per id and hands it back", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body, auth: init.headers?.Authorization });
    if (url.endsWith("/pending-codes")) return new Response(JSON.stringify({ pending: [{ id: "id-1" }, { id: "id-2" }] }));
    return new Response(JSON.stringify({ ok: true }));
  };
  const labels = [];
  const issue = async (label) => {
    labels.push(label);
    return label.endsWith("id-2") ? "no code" : "label=x  code=ZT-ABCDEFGH  promotion_code=promo_1";
  };
  const result = await drain({ base: "https://cloud.test", token: "t".repeat(40), issue, fetchImpl });
  assert.deepEqual(result, { waiting: 2, issued: 1, failed: 1 });
  assert.deepEqual(labels, ["zenod-tester-id-1", "zenod-tester-id-2"]);
  assert.equal(calls[1].url, "https://cloud.test/api/ops/testers/codes");
  assert.deepEqual(JSON.parse(calls[1].body), { id: "id-1", code: "ZT-ABCDEFGH" });
  assert.ok(calls.every((call) => call.auth === `Bearer ${"t".repeat(40)}`));
});

test("a dry run only counts", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ pending: [{ id: "a" }] }));
  const result = await drain({ base: "https://x", token: "t", issue: async () => assert.fail("no issue in a dry run"), fetchImpl, dryRun: true });
  assert.deepEqual(result, { waiting: 1, issued: 0, failed: 0 });
});

test("needs a token file", () => {
  assert.throws(() => parseArgs([]), /token-file/);
  assert.equal(parseArgs(["--token-file", "/tmp/t"]).base, "https://cloud.zenod.dev");
});
