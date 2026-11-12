// E15-Q3: the live tier's cache and caps, on a stub client (no network, no key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveCapError, LiveModel, normalise, restore, stagingLive } from "./live.mjs";

function stub(usdPerCall = 0.004) {
  const seen = [];
  const make = (onUsage) => ({
    async classify(input) { seen.push(input); onUsage({ providerCostUsd: usdPerCall }); return { pages: [{ path: `Notes/${input.ref}.md` }], ref: input.ref }; },
    async streamMemoryChat(input, onText) { seen.push(input); onUsage({ providerCostUsd: usdPerCall }); onText("frog"); return `frog, filed at ${input.prompt.match(/\d\d:\d\d/)?.[0]}`; },
  });
  return { make, seen };
}

const fresh = (extra = {}) => {
  const s = stub();
  return { s, m: new LiveModel({ make: s.make, model: "stub", dir: mkdtempSync(join(tmpdir(), "live-test-")), runCapUsd: 1, monthCapUsd: 5, runId: "t", ...extra }) };
};

test("run-specific tokens become placeholders and come back", () => {
  const { text, tokens } = normalise("note e-1a2b3c on 2026-11-09 (Monday), now 06:02 UTC, e-1a2b3c again");
  assert.equal(text, "note ⟦A0⟧ on ⟦D2⟧ (⟦W4⟧), now ⟦H3⟧ UTC, ⟦A1⟧ again");
  assert.equal(restore(text, tokens), "note e-1a2b3c on 2026-11-09 (Monday), now 06:02 UTC, e-1a2b3c again");
});

test("a clock time that equals a time in a memory does not change the key a minute later", () => {
  const at = (now) => normalise(`now ${now} UTC. Memory: call at 06:10.`).text;
  assert.equal(at("06:10"), at("06:11"));
});

test("a reply keeps values it did not receive literally", () => {
  const { tokens } = normalise("ref e-aaaaaa");
  assert.equal(normalise("cites e-aaaaaa and e-cccccc", tokens, true).text, "cites ⟦A0⟧ and e-cccccc");
});

test("a rerun on the same input replays from the cache, swaps in the new anchor and costs nothing", async () => {
  const { s, m } = fresh();
  const first = await m.classify({ content: "spare key under the frog", ref: "e-aaaaaa" });
  assert.deepEqual(first.pages, [{ path: "Notes/e-aaaaaa.md" }]);
  const again = new LiveModel({ make: s.make, model: "stub", dir: m.dir, runCapUsd: 1, monthCapUsd: 5, runId: "t2" });
  const second = await again.classify({ content: "spare key under the frog", ref: "e-bbbbbb" });
  assert.deepEqual(second.pages, [{ path: "Notes/e-bbbbbb.md" }]);
  assert.equal(s.seen.length, 1);
  assert.deepEqual(again.calls, { live: 0, cached: 1, refused: 0, failed: 0 });
  assert.equal(again.spentUsd, 0);
});

test("a cached answer replays its text through onText, a minute later too", async () => {
  const { s, m } = fresh();
  let streamed = "";
  await m.streamMemoryChat({ system: "s", prompt: "now 06:00 UTC: where is the key?" }, (t) => { streamed += t; });
  const again = new LiveModel({ make: s.make, model: "stub", dir: m.dir, runCapUsd: 1, monthCapUsd: 5, runId: "t2" });
  let replay = "";
  const out = await again.streamMemoryChat({ system: "s", prompt: "now 06:01 UTC: where is the key?" }, (t) => { replay += t; });
  assert.equal(s.seen.length, 1);
  assert.equal(out, "frog, filed at 06:01");
  assert.equal(replay, out);
  assert.equal(again.lastAnswerText, out);
});

test("the run cap refuses a new call before it is sent", async () => {
  const { s, m } = fresh({ runCapUsd: 0.012 }); // one call 0.004 spent + 0.01 reserved for the next passes it
  await m.classify({ content: "one", ref: "e-000001" });
  await assert.rejects(m.classify({ content: "two", ref: "e-000002" }), LiveCapError);
  assert.equal(s.seen.length, 1);
  assert.equal(m.calls.refused, 1);
});

test("the month cap counts earlier runs from the ledger", async () => {
  const { s, m } = fresh();
  for (let i = 0; i < 3; i++) await m.classify({ content: `n${i}`, ref: "e-000003" });
  const ledger = readFileSync(join(m.dir, "spend.jsonl"), "utf8").trim().split("\n");
  assert.equal(ledger.length, 3);
  const next = new LiveModel({ make: s.make, model: "stub", dir: m.dir, runCapUsd: 1, monthCapUsd: 0.02, runId: "t2" });
  await assert.rejects(next.classify({ content: "new", ref: "e-000004" }), /month cap/);
  assert.equal(s.seen.length, 3);
});

test("only methods the real client has are visible to the engine", () => {
  const { m } = fresh();
  assert.equal(typeof m.classify, "function");
  assert.equal(m.reconcile, undefined);
});

test("a failed call is counted with its reason in a few words, never cached", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-test-"));
  const make = () => ({ async reconcile() { throw new Error("reconciliation_unavailable", { cause: Object.assign(new Error("No object generated: response did not match schema."), { name: "AI_NoObjectGeneratedError" }) }); } });
  const m = new LiveModel({ make, model: "stub", dir, runCapUsd: 1, monthCapUsd: 5, runId: "t" });
  await assert.rejects(m.reconcile({ sources: [] }), /reconciliation_unavailable/);
  await assert.rejects(m.reconcile({ sources: [] }), /reconciliation_unavailable/);
  assert.equal(m.calls.failed, 2);
  assert.deepEqual(m.summary().failures, { "reconcile: Error: reconciliation_unavailable (AI_NoObjectGeneratedError: No object generated: response did not match schema.)": 2 });
});

test("E7-S3: Claude through staging sends one call per method with the tenant token, counts its price and caches it", async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, auth: init.headers.authorization, method: body.method });
    const out = body.method === "streamMemoryChat" ? "frog" : { pages: [] };
    return { ok: true, status: 200, json: async () => ({ ok: true, out, model: "claude-haiku-5-5", costUsd: 0.002, inputTokens: 10, outputTokens: 2 }) };
  };
  const dir = mkdtempSync(join(tmpdir(), "live-test-"));
  const m = stagingLive({ url: "http://staging:8781/", token: "tok", model: "claude", dir, runCapUsd: 1, monthCapUsd: 5, runId: "t", fetchImpl });
  let streamed = "";
  assert.equal(await m.streamMemoryChat({ system: "s", prompt: "q" }, (d) => { streamed += d; }), "frog");
  assert.equal(streamed, "frog");
  assert.deepEqual(await m.classify({ ref: "x" }), { pages: [] });
  assert.deepEqual(await m.classify({ ref: "x" }), { pages: [] });
  assert.deepEqual(sent, [
    { url: "http://staging:8781/api/credit/eval-call", auth: "Bearer tok", method: "streamMemoryChat" },
    { url: "http://staging:8781/api/credit/eval-call", auth: "Bearer tok", method: "classify" },
  ]);
  assert.equal(m.summary().spentUsd, 0.004);
  assert.deepEqual(m.calls, { live: 2, cached: 1, refused: 0, failed: 0 });
});

test("E7-S3: a refused staging call (its cap) fails the call and names why, without a body", async () => {
  const fetchImpl = async () => ({ ok: false, status: 502, json: async () => ({ ok: false, name: "LlmAllowanceExceededError", status: null, error: "This month's AI allowance for this account is used up." }) });
  const m = stagingLive({ url: "http://s", token: "t", model: "claude", dir: mkdtempSync(join(tmpdir(), "live-test-")), runCapUsd: 1, monthCapUsd: 5, runId: "t", fetchImpl });
  await assert.rejects(m.classify({ ref: "y" }), /LlmAllowanceExceededError/);
  assert.equal(m.calls.failed, 1);
});
