// E7-S17: the facts behind the daily tester picture.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { LAST_SEEN_EVERY_MS, mountTesterProgressRoute, TesterLastSeen, tenantJobCounts, vaultState } from "../src/testerProgress.js";
import type { WhatsAppSetupRead } from "../src/zenodPhylax.js";

const account = (id: string, email: string, extra: Partial<CustomerAccount> = {}) =>
  ({ account_id: id, user_id: `u-${id}`, stripe_email: email, github_email: null, tenant_id: `t-${id}`, subscription_status: "active",
     claimed_at: "2026-11-13T20:35:31.021Z", vault_provider: null, vault_repo: null, ...extra }) as CustomerAccount;

describe("vaultState", () => {
  it("ready GitHub or Drive binding is set, anything else is not", () => {
    const base = { vault_binding_id: "b", vault_binding_created_at: "x", vault_binding_updated_at: "x", tenant_id: "t" };
    expect(vaultState(account("a", "a@x.io", { ...base, vault_provider: "github", vault_binding_status: "ready", vault_branch: "main", vault_repo: "o/r" }))).toMatchObject({ set: true, provider: "github" });
    expect(vaultState(account("a", "a@x.io", { ...base, vault_provider: "google_drive", vault_binding_status: "ready", vault_drive_folder_id: "f", vault_drive_manifest_file_id: "m" }))).toMatchObject({ set: true, provider: "google_drive" });
    expect(vaultState(account("a", "a@x.io", { ...base, vault_provider: "google_drive", vault_binding_status: "authorizing" })).set).toBe(false);
    expect(vaultState(account("a", "a@x.io")).set).toBe(false);
    expect(vaultState(account("a", "a@x.io", { vault_repo: "o/r" }))).toMatchObject({ set: true, status: "legacy" });
  });
});

describe("TesterLastSeen", () => {
  it("writes once per person per 5 minutes and survives a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "seen-"));
    try {
      let now = 1_000_000;
      const seen = new TesterLastSeen(dir, () => now);
      seen.touch("u1");
      now += 60_000;
      seen.touch("u1");
      expect(seen.seenAt("u1")).toBe(1_000_000);
      now += LAST_SEEN_EVERY_MS;
      seen.touch("u1");
      expect(new TesterLastSeen(dir).seenAt("u1")).toBe(now);
      expect(seen.seenAt("nobody")).toBeNull();
      expect(new TesterLastSeen(dir).since()).toBe(1_000_000);
      expect(readFileSync(join(dir, "tester-last-seen.json"), "utf8")).toContain("u1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("tenantJobCounts", () => {
  it("counts WhatsApp notes any outcome, finished memories on any channel, self-tests left out", () => {
    const dir = mkdtempSync(join(tmpdir(), "jobs-"));
    try {
      const path = join(dir, "tasks.sqlite");
      const db = new DatabaseSync(path);
      db.exec("CREATE TABLE task_jobs (tenant_id TEXT, kind TEXT, status TEXT, updated_at INTEGER, idempotency_key TEXT, input_json TEXT)");
      const ins = db.prepare("INSERT INTO task_jobs VALUES (?,?,?,?,?,?)");
      const now = 10 * 86_400_000;
      ins.run("t", "store", "done", now - 1000, "x:whatsapp:1", "{}");
      ins.run("t", "store", "failed", now - 2000, "x:whatsapp:2", "{}");
      ins.run("t", "media_ingest", "done", now - 3 * 86_400_000, "k", '{"source":"web"}');
      ins.run("t", "store", "done", now - 1000, "k2", '{"source":"selftest"}');
      ins.run("t", "media_ingest", "failed", now - 1000, "k3", '{"mediaType":"audio","source":"web"}');
      ins.run("t", "media_ingest", "done", now - 1000, "k4", '{"mediaType":"pdf"}');
      ins.run("other", "store", "done", now - 1000, "x:whatsapp:3", "{}");
      db.close();
      expect(tenantJobCounts(path, "t", now - 86_400_000)).toEqual({ whatsappNotes: 2, whatsappNotes24h: 2, memoriesSaved: 3, memoriesSaved24h: 2, voiceNotes: 1 });
      expect(tenantJobCounts(join(dir, "none.sqlite"), "t", 0).memoriesSaved).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("GET /api/ops/testers/progress", () => {
  const read = (extra: Partial<WhatsAppSetupRead> = {}): WhatsAppSetupRead => ({
    bound: true, state: "verified", attempts: 1, lastAttemptAt: null, lastStatus: 200, lastCode: null, ...extra,
  });
  const accounts = [
    account("user-usr_aaaa9477", "dana@gmail.com"),
    account("user-usr_bbbb1111", "ops@alpha9.io"),
    account("user-usr_cccc2222", "two@x.io", { claimed_at: "2026-11-14T00:00:00Z" }),
    account("user-usr_dddd3333", "two@x.io", { claimed_at: "2026-11-15T00:00:00Z", vault_repo: "o/r" }),
  ];
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountTesterProgressRoute(app, {
    accounts: () => accounts,
    isTester: (a) => a.account_id !== "user-usr_zzzz",
    isTest: (a) => (a.stripe_email ?? "").endsWith("@alpha9.io"),
    setup: async (id) => (id.endsWith("3333") ? read() : read({ state: "off", attempts: 0, lastStatus: null })),
    isOps: (c) => c.req.header("authorization") === "Bearer ops",
    counts: (tenantId) => ({ whatsappNotes: tenantId.endsWith("3333") ? 2 : 0, whatsappNotes24h: 1, memoriesSaved: 1, memoriesSaved24h: 0, voiceNotes: 1 }),
    welcomeSentAt: (accountId) => (accountId.endsWith("3333") ? "2026-11-19T08:00:00.000Z" : accountId.endsWith("cccc2222") ? "2026-11-18T08:00:00.000Z" : null),
    seenSince: () => Date.parse("2026-11-20T09:00:00Z"),
    seenAt: (userId) => (userId.endsWith("aaaa9477") ? Date.parse("2026-11-20T10:00:00Z") : null),
    now: () => Date.parse("2026-11-20T22:00:00Z"),
  });
  const get = (auth?: string) => app.request("/api/ops/testers/progress", { headers: auth ? { authorization: auth } : {} });

  it("is 404 without the ops token", async () => {
    expect((await get()).status).toBe(404);
    expect((await get("Bearer wrong")).status).toBe(404);
  });

  it("returns real testers only, masked, one tester per person", async () => {
    const res = await get("Bearer ops");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lastSeenSince: string; testers: Array<Record<string, any>> };
    expect(body.lastSeenSince).toBe("2026-11-20T09:00:00.000Z");
    expect(body.testers).toHaveLength(2);
    const [dana, two] = body.testers;
    expect(dana).toMatchObject({ key: "aaaa9477".slice(-8), lastSeenAt: "2026-11-20T10:00:00.000Z", vault: { set: false }, whatsapp: { linked: false } });
    expect(two).toMatchObject({ vault: { set: true }, whatsapp: { linked: true }, whatsappNotes: 2, memoriesSaved: 2, voiceNotes: 2, welcomeSentAt: "2026-11-18T08:00:00.000Z" });
    expect(dana).toMatchObject({ voiceNotes: 1, welcomeSentAt: null });
    const text = JSON.stringify(body);
    expect(text).not.toContain("dana@gmail.com");
    expect(text).not.toContain("two@x.io");
    expect(text).toContain("d***@g***");
  });
});
