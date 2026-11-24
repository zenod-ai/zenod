// E7-S17: the facts behind the daily tester picture.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { LAST_SEEN_EVERY_MS, mountTesterProgressRoute, TesterLastSeen, tenantJobCounts, tenantMcpReads, vaultState } from "../src/testerProgress.js";
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
      expect(tenantJobCounts(path, "t", now - 86_400_000)).toEqual({
        whatsappNotes: 2, whatsappNotes24h: 2, memoriesSaved: 3, memoriesSaved24h: 2, voiceNotes: 1,
        // E7-S31: this older table has no result_json, so the read and write split stays 0 and the E7-S27 counts still hold
        whatsappWrites: 0, whatsappReads: 0, agentWrites: 0, agentChats: 0,
      });
      expect(tenantJobCounts(join(dir, "none.sqlite"), "t", 0).memoriesSaved).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("E7-S31 memory reads and writes by channel", () => {
  it("splits finished saves and answers into WhatsApp and agents (MCP), web app and self-tests left out", () => {
    const dir = mkdtempSync(join(tmpdir(), "use-"));
    try {
      const path = join(dir, "tasks.sqlite");
      const db = new DatabaseSync(path);
      db.exec("CREATE TABLE task_jobs (tenant_id TEXT, kind TEXT, status TEXT, updated_at INTEGER, idempotency_key TEXT, input_json TEXT, result_json TEXT)");
      const ins = db.prepare("INSERT INTO task_jobs VALUES (?,?,?,?,?,?,?)");
      ins.run("t", "store", "done", 1, "t:whatsapp:1", "{}", null); // WhatsApp write
      ins.run("t", "media_ingest", "done", 1, "t:whatsapp:2", '{"mediaType":"audio"}', null); // WhatsApp voice note saved
      ins.run("t", "store", "done", 1, "whatsapp-keep:x", '{"source":"whatsapp"}', null); // kept from a WhatsApp chat turn
      ins.run("t", "store", "failed", 1, "t:whatsapp:3", "{}", null); // not saved: not a write
      ins.run("t", "chat", "done", 1, "t:whatsapp:4", '{"source":"whatsapp"}', '{"outcome":"answer"}'); // WhatsApp read
      ins.run("t", "chat", "done", 1, "t:whatsapp:5", '{"source":"whatsapp"}', '{"outcome":"both"}'); // read and keep
      ins.run("t", "chat", "done", 1, "t:whatsapp:6", '{"source":"whatsapp"}', '{"outcome":"keep"}'); // keep only: no read
      ins.run("t", "store", "done", 1, null, '{"source":"claude-code"}', null); // agent write, no idempotency key
      ins.run("t", "store", "done", 1, "abc", "{}", null); // agent write
      ins.run("t", "chat", "done", 1, null, "{}", '{"text":"..."}'); // an agent asked Zenod
      ins.run("t", "store", "done", 1, null, '{"source":"web"}', null); // the web app: neither
      ins.run("t", "store", "done", 1, "t:telegram:1", "{}", null); // Telegram: neither
      ins.run("t", "store", "done", 1, null, '{"source":"selftest"}', null); // our self-test: never
      ins.run("other", "store", "done", 1, "abc", "{}", null);
      db.close();
      expect(tenantJobCounts(path, "t", 0)).toMatchObject({ whatsappWrites: 3, whatsappReads: 2, agentWrites: 2, agentChats: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts an agent's MCP read-tool calls from the usage ledger, by tool name only", () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      const path = join(dir, "usage.sqlite");
      const db = new DatabaseSync(path);
      db.exec("CREATE TABLE tenant_usage (id INTEGER PRIMARY KEY, tenant_id TEXT, ts INTEGER, kind TEXT, units INTEGER, metadata_json TEXT)");
      const ins = db.prepare("INSERT INTO tenant_usage (tenant_id, ts, kind, units, metadata_json) VALUES (?,?,?,?,?)");
      ins.run("t", 100, "mcp.request", 1, null); // before tool names were recorded: cannot be split
      ins.run("t", 200, "mcp.request", 2, '{"tools":["search_memory","get_memory"]}');
      ins.run("t", 300, "mcp.request", 1, '{"tools":["store_memory"]}'); // a write, counted from the jobs
      ins.run("t", 400, "mcp.request", 1, '{"tools":["chat_with_zenod"]}'); // WhatsApp's door: counted from the jobs
      ins.run("t", 500, "mcp.request", 1, '{"tools":["ask_brain"]}');
      ins.run("t", 600, "api.request", 1, '{"tools":["search_memory"]}');
      ins.run("other", 700, "mcp.request", 1, '{"tools":["search_memory"]}');
      db.close();
      expect(tenantMcpReads(path, "t")).toEqual({ reads: 3, since: 200 });
      expect(tenantMcpReads(path, "nobody")).toEqual({ reads: 0, since: 200 });
      expect(tenantMcpReads(join(dir, "none.sqlite"), "t")).toEqual({ reads: 0, since: null });
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
    counts: (tenantId) => ({
      whatsappNotes: tenantId.endsWith("3333") ? 2 : 0, whatsappNotes24h: 1, memoriesSaved: 1, memoriesSaved24h: 0, voiceNotes: 1,
      whatsappWrites: tenantId.endsWith("3333") ? 2 : 0, whatsappReads: tenantId.endsWith("3333") ? 1 : 0,
      agentWrites: tenantId.endsWith("2222") ? 1 : 0, agentChats: 0,
    }),
    // E7-S31: the second person signed in from Claude on their first account; Dana never connected an assistant.
    mcpSignIn: (accountId) => (accountId.endsWith("cccc2222") ? { via: "oauth", at: Date.parse("2026-11-16T12:00:00Z") } : null),
    mcpReads: (tenantId) => ({ reads: tenantId.endsWith("cccc2222") ? 4 : 0, since: Date.parse("2026-11-16T00:00:00Z") }),
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
    // E7-S31: the MCP step and the reads and writes by channel, summed over one person's two accounts
    expect(dana.mcp).toEqual({ connected: false, via: null, at: null });
    expect(dana.memoryUse).toEqual({ whatsapp: { reads: 0, writes: 0 }, agents: { reads: 0, writes: 0 }, agentReadsSince: "2026-11-16T00:00:00.000Z" });
    expect(two.mcp).toEqual({ connected: true, via: "oauth", at: "2026-11-16T12:00:00.000Z" });
    expect(two.memoryUse).toMatchObject({ whatsapp: { reads: 1, writes: 2 }, agents: { reads: 4, writes: 1 } });
    const text = JSON.stringify(body);
    expect(text).not.toContain("dana@gmail.com");
    expect(text).not.toContain("two@x.io");
    expect(text).toContain("d***@g***");
  });
});
