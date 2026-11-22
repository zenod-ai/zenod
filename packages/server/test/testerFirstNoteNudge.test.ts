// E7-S26 round 3 (Jordi, vn_bd12b21e): one WhatsApp reminder 48 hours after the code handshake, only with storage set up and
// nothing sent since, once per tester; shipped OFF until the switch.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { ZENOD_WHATSAPP_FIRST_NOTE_NUDGE } from "../src/phylaxWhatsAppWelcome.js";
import { phylaxAccountNoticeText } from "../src/phylaxManagementMcp.js";
import { mountTesterFirstNoteNudgeRoutes, TesterFirstNoteNudge } from "../src/testerFirstNoteNudge.js";
import type { WhatsAppSetupRead } from "../src/zenodPhylax.js";

let nowMs = new Date("2026-11-22T14:00:00Z").getTime();
const hoursAgo = (h: number) => new Date(nowMs - h * 3600_000).toISOString();
const read = (state: string): WhatsAppSetupRead => ({
  bound: true, binding: "active", state, attempts: 1, lastAttemptAt: null, lastStatus: null, lastCode: null,
} as unknown as WhatsAppSetupRead);
const account = (id: string, email: string) =>
  ({ account_id: id, stripe_email: email, github_email: null, tenant_id: `t-${id}`, subscription_status: "active", claimed_at: hoursAgo(80) }) as CustomerAccount;

function setup(opts: {
  accounts: CustomerAccount[];
  reads?: Record<string, string>;
  linkedAt?: Record<string, string>;
  notes?: Record<string, number>;
  /** accounts whose storage is NOT set up (default: every account has it) */
  noStorage?: string[];
  envMode?: "on" | "off";
  send?: (accountId: string) => "sent" | "skipped" | "failed";
}) {
  const sends: string[] = [];
  const nudge = new TesterFirstNoteNudge({
    dataDir: mkdtempSync(join(tmpdir(), "first-note-")),
    envMode: opts.envMode ?? "off",
    accounts: () => opts.accounts,
    isTester: () => true,
    isTest: (a) => a.stripe_email === "ops@alpha9.io",
    setup: async (id) => read(opts.reads?.[id] ?? "off"),
    linkedAt: (id) => opts.linkedAt?.[id] ?? null,
    vaultSet: (a) => !(opts.noStorage ?? []).includes(a.account_id),
    noteCount: (tenantId) => opts.notes?.[tenantId] ?? 0,
    send: async (a, operationId) => {
      sends.push(operationId);
      return opts.send?.(a.account_id) ?? "sent";
    },
    now: () => new Date(nowMs),
  });
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountTesterFirstNoteNudgeRoutes(app, { isOps: (c) => c.req.header("authorization") === "Bearer ok", nudge });
  const call = (path: string, body?: unknown) => app.request(path, {
    method: body ? "POST" : "GET",
    headers: { authorization: "Bearer ok", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { nudge, sends, call, app };
}

describe("the message", () => {
  it("is Jordi's own words as Zenod, capitalized, short, no list", () => {
    const text = ZENOD_WHATSAPP_FIRST_NOTE_NUDGE;
    expect(text).toBe("Hi, it's Zenod. Just a reminder that I'm here. Feel free to send me any thoughts you want to keep.");
    expect(text.split(/\s+/).length).toBeLessThan(25);
    expect(text.startsWith("Hi, it's Zenod.")).toBe(true);
    expect(text).not.toMatch(/Jordi/);
    expect(text).not.toMatch(/[\n•*]|—/);
    for (const sentence of text.split(/(?<=\.)\s+/)) expect(sentence[0]).toBe(sentence[0]!.toUpperCase());
    expect(phylaxAccountNoticeText("zenod", "first_note_nudge", "https://cloud.zenod.dev")).toBe(text);
  });
});

describe("shipped off", () => {
  it("sends nothing and reads nothing while off, then sends once when switched on", async () => {
    const a = account("acct-ana", "ana@x.io");
    const { nudge, sends, call } = setup({ accounts: [a], reads: { "acct-ana": "verified" }, linkedAt: { "acct-ana": hoursAgo(50) } });
    expect(nudge.mode()).toBe("off");
    expect(await nudge.sweep()).toEqual({ sent: 0, failed: 0 });
    expect(sends).toEqual([]);
    expect((await (await call("/api/ops/testers/first-note-nudge", { mode: "on", by: "test" })).json()).mode).toBe("on");
    await nudge.sweep();
    expect(sends).toEqual(["first-note-nudge-acct-ana"]);
    expect(nudge.status().sent).toBe(1);
  });

  it("ops routes need the ops token", async () => {
    const { app } = setup({ accounts: [] });
    expect((await app.request("/api/ops/testers/first-note-nudge")).status).toBe(404);
    expect((await app.request("/api/ops/testers/first-note-nudge", { method: "POST", body: "{}" })).status).toBe(404);
  });

  it("an off switch lands before the next message", async () => {
    const accounts = [account("acct-a", "a@x.io"), account("acct-b", "b@x.io")];
    const { nudge, sends } = setup({
      accounts, envMode: "on",
      reads: { "acct-a": "verified", "acct-b": "verified" },
      linkedAt: { "acct-a": hoursAgo(50), "acct-b": hoursAgo(50) },
      send: () => { nudge.setMode("off", "test"); return "sent"; },
    });
    await nudge.sweep();
    expect(sends).toHaveLength(1);
  });
});

describe("who gets it", () => {
  it("only a real tester 48 hours after the handshake with no note; never a test account, an unlinked, a too-new or one with a note", async () => {
    const accounts = [
      account("acct-due", "due@x.io"),
      account("acct-new", "new@x.io"),
      account("acct-notlinked", "nl@x.io"),
      account("acct-note", "note@x.io"),
      account("acct-ops", "ops@alpha9.io"),
    ];
    const { nudge, sends } = setup({
      accounts, envMode: "on",
      reads: { "acct-due": "verified", "acct-new": "verified", "acct-note": "verified", "acct-ops": "verified" },
      linkedAt: { "acct-due": hoursAgo(49), "acct-new": hoursAgo(30), "acct-note": hoursAgo(60), "acct-ops": hoursAgo(60), "acct-notlinked": hoursAgo(60) },
      notes: { "t-acct-note": 1 },
    });
    await nudge.sweep();
    expect(sends).toEqual(["first-note-nudge-acct-due"]);
  });

  it("the trigger is 48 hours after the handshake: nothing at 47 hours, one message at 49, and due() names the moment", async () => {
    const { nudge, sends, call } = setup({
      accounts: [account("acct-a", "a@x.io"), account("acct-b", "b@x.io")], envMode: "on",
      reads: { "acct-a": "verified", "acct-b": "verified" },
      linkedAt: { "acct-a": hoursAgo(47), "acct-b": hoursAgo(49) },
    });
    const due = await (await call("/api/ops/testers/first-note-nudge/due")).json();
    expect(due.due).toHaveLength(1);
    expect(due.due[0].dueAt).toBe(hoursAgo(1));
    await nudge.sweep();
    expect(sends).toEqual(["first-note-nudge-acct-b"]);
  });

  it("never without storage set up; it goes once the storage is connected, still counted from the handshake", async () => {
    const noStorage = ["acct-s"];
    const { nudge, sends } = setup({
      accounts: [account("acct-s", "s@x.io"), account("acct-ok", "ok@x.io")], envMode: "on",
      reads: { "acct-s": "verified", "acct-ok": "verified" },
      linkedAt: { "acct-s": hoursAgo(60), "acct-ok": hoursAgo(60) },
      noStorage,
    });
    await nudge.sweep();
    expect(sends).toEqual(["first-note-nudge-acct-ok"]);
    expect(nudge.status().sent).toBe(1);
    noStorage.length = 0;
    await nudge.sweep();
    expect(sends).toEqual(["first-note-nudge-acct-ok", "first-note-nudge-acct-s"]);
  });

  it("nothing sent since the handshake: a tester who sent a voice note or saved a memory gets nothing", async () => {
    const { nudge, sends } = setup({
      accounts: [account("acct-v", "v@x.io"), account("acct-m", "m@x.io"), account("acct-quiet", "q@x.io")], envMode: "on",
      reads: { "acct-v": "verified", "acct-m": "verified", "acct-quiet": "verified" },
      linkedAt: { "acct-v": hoursAgo(60), "acct-m": hoursAgo(60), "acct-quiet": hoursAgo(60) },
      notes: { "t-acct-v": 2, "t-acct-m": 1 },
    });
    await nudge.sweep();
    expect(sends).toEqual(["first-note-nudge-acct-quiet"]);
  });

  it("a tester linked on another account of the same person is not messaged on this one", async () => {
    const accounts = [account("acct-1", "same@x.io"), account("acct-2", "same@x.io")];
    const { nudge, sends } = setup({
      accounts, envMode: "on",
      reads: { "acct-1": "verified", "acct-2": "off" },
      linkedAt: { "acct-1": hoursAgo(50) },
    });
    await nudge.sweep();
    expect(sends).toEqual(["first-note-nudge-acct-1"]);
  });

  it("waits a full 48 hours from the first time it saw the link when it never watched it", async () => {
    nowMs = new Date("2026-11-22T14:00:00Z").getTime();
    const { nudge, sends } = setup({ accounts: [account("acct-x", "x@x.io")], envMode: "on", reads: { "acct-x": "verified" } });
    await nudge.sweep();
    expect(sends).toEqual([]);
    nowMs += 47 * 3600_000;
    await nudge.sweep();
    expect(sends).toEqual([]);
    nowMs += 2 * 3600_000;
    await nudge.sweep();
    expect(sends).toEqual(["first-note-nudge-acct-x"]);
  });
});

describe("once per tester", () => {
  it("never sends twice, by account or by address", async () => {
    const accounts = [account("acct-1", "same@x.io"), account("acct-2", "same@x.io")];
    const { nudge, sends } = setup({
      accounts, envMode: "on",
      reads: { "acct-1": "verified", "acct-2": "verified" },
      linkedAt: { "acct-1": hoursAgo(50), "acct-2": hoursAgo(50) },
    });
    await nudge.sweep();
    await nudge.sweep();
    expect(sends).toEqual(["first-note-nudge-acct-1"]);
    expect(nudge.status().sent).toBe(1);
  });

  it("a failed send is retried, but only three times; a skipped one is not counted", async () => {
    const outcome = { value: "failed" as "sent" | "skipped" | "failed" };
    const { nudge, sends } = setup({
      accounts: [account("acct-f", "f@x.io")], envMode: "on",
      reads: { "acct-f": "verified" }, linkedAt: { "acct-f": hoursAgo(50) },
      send: () => outcome.value,
    });
    outcome.value = "skipped";
    await nudge.sweep(); await nudge.sweep();
    expect(nudge.status().failedGivenUp).toBe(0);
    outcome.value = "failed";
    for (let i = 0; i < 5; i += 1) await nudge.sweep();
    expect(sends.filter((id) => id === "first-note-nudge-acct-f")).toHaveLength(5);
    expect(nudge.status()).toMatchObject({ sent: 0, failedGivenUp: 1 });
  });
});
