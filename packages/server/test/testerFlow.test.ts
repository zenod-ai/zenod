import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { describe, expect, it, vi } from "vitest";
import { TesterMarks } from "../src/testerMarks.js";
import { COUNT_DEFINITIONS } from "../src/publicCounts.js";
import {
  generateTesterCode,
  mountTesterFlowRoutes,
  normalizeTesterEmail,
  resendMailer,
  stripeMinter,
  TESTER_FLOW_FILE,
  TesterFlow,
  testerFlowFromEnv,
  WAITING_FOR_CODE,
  WAITING_FOR_MAIL,
  type TesterMail,
} from "../src/testerFlow.js";

const NOW = new Date("2026-11-10T17:00:00Z");
const OPS = "o".repeat(40);

function flowWith(options: Partial<ConstructorParameters<typeof TesterFlow>[0]> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "zenod-tester-flow-"));
  const mails: TesterMail[] = [];
  let n = 0;
  const flow = new TesterFlow({
    dataDir,
    now: () => NOW,
    mint: async () => `ZT-CODE000${++n}`,
    sendMail: async (mail) => {
      mails.push(mail);
    },
    ...options,
  });
  return { dataDir, flow, mails };
}

describe("tester flow (EPIC-26 S2)", () => {
  it("accepts the first ten automatically, mints a code only for each and emails their personal link", async () => {
    const { dataDir, flow, mails } = flowWith();
    for (let i = 1; i <= 11; i += 1) expect(flow.receive(`person${i}@example.com`)).toBe(i <= 10 ? "accepted" : "waitlist");
    await flow.process();
    expect(mails).toHaveLength(10);
    expect(new Set(mails.map((mail) => mail.to)).size).toBe(10);
    expect(mails[0]).toMatchObject({ to: "person1@example.com", subject: "Your Zenod tester link" });
    expect(mails[0]!.text).toContain("https://cloud.zenod.dev/join?code=ZT-CODE0001");
    expect(mails[0]!.html).toContain('href="https://cloud.zenod.dev/join?code=ZT-CODE0001"');
    expect(mails[0]!.text).toContain("until 24 November 2026");
    const snap = flow.snapshot();
    expect(snap.accepting).toBe(false);
    expect(snap.testers.filter((t) => t.emailedAt)).toHaveLength(10);
    expect(snap.testers[10]).toMatchObject({ status: "waitlist" });
    expect(snap.testers[10]).not.toHaveProperty("code");
    expect(statSync(join(dataDir, TESTER_FLOW_FILE)).mode & 0o077).toBe(0);

    await flow.process();
    expect(mails).toHaveLength(10);
  });

  it("keeps the first place for the same email and never mails it twice", async () => {
    const { flow, mails } = flowWith();
    expect(flow.receive("Me@Example.com")).toBe("accepted");
    expect(flow.receive("me@example.com")).toBe("accepted");
    await flow.process();
    await flow.process();
    expect(mails).toHaveLength(1);
    expect(flow.snapshot().testers).toHaveLength(1);
  });

  it("sends everyone to the waitlist while the stop switch is on, and accepts again when it is off", () => {
    const { flow } = flowWith();
    flow.setPaused(true);
    expect(flow.receive("a@example.com")).toBe("waitlist");
    flow.setPaused(false);
    expect(flow.receive("b@example.com")).toBe("accepted");
  });

  it("accepts nobody automatically when the server setting turns it off", () => {
    const { flow } = flowWith({ autoAccept: false });
    expect(flow.receive("a@example.com")).toBe("waitlist");
    const id = flow.snapshot().testers[0]!.id;
    expect(flow.acceptById(id)).toBe(true);
    expect(flow.snapshot().testers[0]).toMatchObject({ status: "accepted" });
  });

  it("queues the code until the code command attaches one, then mails", async () => {
    const { flow, mails } = flowWith({ mint: null });
    flow.receive("a@example.com");
    await flow.process();
    expect(mails).toEqual([]);
    expect(flow.snapshot().testers[0]).toMatchObject({ waiting: WAITING_FOR_CODE });
    const [pending] = flow.pendingCodes();
    expect(pending).toEqual({ id: expect.any(String), since: NOW.toISOString() });
    expect(JSON.stringify(flow.pendingCodes())).not.toContain("example.com");
    expect(flow.attachCode(pending!.id, "ZT-ABCDEFGH")).toBe(true);
    expect(flow.attachCode(pending!.id, "ZT-SECOND00")).toBe(false);
    await flow.process();
    expect(mails.map((mail) => mail.to)).toEqual(["a@example.com"]);
    expect(mails[0]!.text).toContain("join?code=ZT-ABCDEFGH");
  });

  it("queues the email when there is no mail key, and when a mint fails it waits for the code command", async () => {
    const noMail = flowWith({ sendMail: null });
    noMail.flow.receive("a@example.com");
    await noMail.flow.process();
    expect(noMail.flow.snapshot().testers[0]).toMatchObject({ code: "ZT-CODE0001", waiting: WAITING_FOR_MAIL });

    const failing = flowWith({ mint: async () => { throw new Error("The provided key does not have the required permissions"); } });
    failing.flow.receive("b@example.com");
    await failing.flow.process();
    expect(failing.flow.snapshot().testers[0]).toMatchObject({ waiting: WAITING_FOR_CODE });
    expect(failing.mails).toEqual([]);
  });

  it("checks emails and makes codes in the tester-code format", () => {
    expect(normalizeTesterEmail(" me@example.com ")).toBe("me@example.com");
    expect(normalizeTesterEmail("u/reddit_name")).toBeNull();
    expect(normalizeTesterEmail("@handle")).toBeNull();
    expect(normalizeTesterEmail("a@b")).toBeNull();
    expect(generateTesterCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBe("ZT-ABCDEFGH");
  });

  it("mints on the tester coupon, single use, 14 days", async () => {
    const create = vi.fn(async (params: { code: string }) => ({ code: params.code }));
    const mint = stripeMinter({ promotionCodes: { create } }, () => NOW)!;
    const code = await mint("tester-1");
    expect(code).toMatch(/^ZT-[A-Z2-9]{8}$/);
    expect(create).toHaveBeenCalledWith({
      coupon: "ZENOD_TESTER_1M",
      code,
      max_redemptions: 1,
      expires_at: Math.floor(NOW.getTime() / 1000) + 14 * 86400,
      metadata: { zenod_tester: "1", zenod_tester_id: "tester-1" },
    });
    expect(stripeMinter({ promotionCodes: {} })).toBeNull();
  });

  it("sends through Resend with the key in the header only", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await resendMailer("re_test", "Zenod <testers@zenod.dev>", "support@zenod.dev", fetchImpl as unknown as typeof fetch)({
      to: "a@example.com", subject: "s", text: "t", html: "<p>h</p>",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "Zenod <testers@zenod.dev>", to: ["a@example.com"], subject: "s", text: "t", html: "<p>h</p>", reply_to: "support@zenod.dev",
    });
    const failing = vi.fn(async () => new Response("{}", { status: 403 }));
    await expect(resendMailer("re_test", "x@zenod.dev", undefined, failing as unknown as typeof fetch)({ to: "a@example.com", subject: "s", text: "t", html: "h" }))
      .rejects.toThrow("mail provider answered 403");
  });

  it("reads production settings: cap, stop setting, minting only when asked, mail only with a key", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "zenod-tester-flow-env-"));
    const stripe = { promotionCodes: { create: async () => ({ code: "x" }) } };
    expect(testerFlowFromEnv(dataDir, {}, stripe).snapshot()).toMatchObject({ cap: 10, autoAccept: true, canMint: false, canMail: false });
    expect(testerFlowFromEnv(dataDir, { ZENOD_TESTER_CAP: "3", ZENOD_TESTER_AUTO_ACCEPT: "0", ZENOD_TESTER_MINT: "stripe", RESEND_API_KEY: "re_x" }, stripe).snapshot())
      .toMatchObject({ cap: 3, autoAccept: false, canMint: true, canMail: true });
  });
});

describe("tester flow routes", () => {
  function routes(admin: boolean) {
    const { flow, mails, dataDir } = flowWith({ mint: null });
    const app = new Hono<{ Bindings: HttpBindings }>();
    mountTesterFlowRoutes(app, flow, { isAdmin: () => admin, opsToken: OPS });
    return { app, flow, mails, dataDir };
  }

  it("lets the code command read waiting ids and attach a code with the ops token only", async () => {
    const { app, flow, mails } = routes(false);
    flow.receive("a@example.com");
    expect((await app.request("/api/ops/testers/pending-codes")).status).toBe(404);
    expect((await app.request("/api/ops/testers/pending-codes", { headers: { authorization: "Bearer wrong" } })).status).toBe(404);
    const list = await app.request("/api/ops/testers/pending-codes", { headers: { authorization: `Bearer ${OPS}` } });
    const { pending } = (await list.json()) as { pending: Array<{ id: string }> };
    expect(pending).toHaveLength(1);
    const post = (body: unknown) => app.request("/api/ops/testers/codes", {
      method: "POST",
      headers: { authorization: `Bearer ${OPS}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect((await post({ id: pending[0]!.id, code: "<x>" })).status).toBe(400);
    expect((await post({ id: "nobody", code: "ZT-ABCDEFGH" })).status).toBe(409);
    expect((await post({ id: pending[0]!.id, code: "ZT-ABCDEFGH" })).status).toBe(200);
    await flow.process();
    expect(flow.snapshot().testers[0]).toMatchObject({ code: "ZT-ABCDEFGH" });
    expect(mails.map((mail) => mail.to)).toEqual(["a@example.com"]);
  });

  it("turns the ops queue off without a long enough token", async () => {
    const { flow } = flowWith();
    const app = new Hono<{ Bindings: HttpBindings }>();
    mountTesterFlowRoutes(app, flow, { opsToken: "short" });
    expect((await app.request("/api/ops/testers/pending-codes", { headers: { authorization: "Bearer short" } })).status).toBe(404);
    expect((await app.request("/admin/testers")).status).toBe(404);
  });

  it("shows the operator the private list and the stop switch, same-origin posts only", async () => {
    const { app, flow } = routes(true);
    flow.receive("a@example.com");
    flow.setPaused(true);
    flow.receive("b@example.com");
    const page = await (await app.request("/admin/testers")).text();
    expect(page).toContain("a@example.com");
    expect(page).toContain(WAITING_FOR_CODE);
    expect(page).toContain("the stop switch is on");
    expect(page).toContain("Turn acceptance back on");

    const crossSite = await app.request("/admin/testers/switch", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "cross-site" },
      body: "accept=on",
    });
    expect(crossSite.status).toBe(404);
    expect(flow.snapshot().paused).toBe(true);

    const on = await app.request("/admin/testers/switch", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" },
      body: "accept=on",
    });
    expect(on.status).toBe(303);
    expect(flow.snapshot().paused).toBe(false);

    const waitlisted = flow.snapshot().testers.find((t) => t.email === "b@example.com")!;
    await app.request("/admin/testers/accept", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" },
      body: `id=${waitlisted.id}`,
    });
    expect(flow.snapshot().testers.find((t) => t.email === "b@example.com")).toMatchObject({ status: "accepted" });
  });

  it("says where the page lives and who asked, shows the counts and every application with its email, tests marked", async () => {
    const { flow, dataDir } = flowWith({ mint: null });
    const marks = new TesterMarks(dataDir);
    const app = new Hono<{ Bindings: HttpBindings }>();
    mountTesterFlowRoutes(app, flow, {
      isAdmin: () => true,
      admin: {
        counts: () => ({ schema: "zenod-counts/v1", date: "2026-11-10", definitions: COUNT_DEFINITIONS, at: "2026-11-10T20:00:00Z", applications: 1, accepted: 1, signed_up: 0, active_testers: 0, paying_customers: 0, test_applications: 1,
          history: [{ date: "2026-11-10", applications: 1, accepted: 1, signed_up: 0, active_testers: 0, paying_customers: 0, test_applications: 1 }] }),
        applications: () => [
          { at: "2026-11-09T06:05:00Z", contact: "TEST", use: "TEST application <b>" },
          { at: "2026-11-10T19:00:00Z", contact: "stranger@gmail.com", use: "My voice notes from walks" },
        ],
        marks,
      },
    });
    flow.receive("stranger@gmail.com");
    const page = await (await app.request("/admin/testers")).text();
    expect(page).toContain("Where this is.");
    expect(page).toContain("cloud.zenod.dev/admin/testers");
    expect(page).toContain("zenod-social");
    expect(page).toContain("/api/public/counts");
    expect(page).toContain("stranger@gmail.com");
    expect(page).toContain("My voice notes from walks");
    expect(page).toContain("came before automatic acceptance");
    expect(page).toContain("2 people have applied: 1 real, 1 our own test.");
    expect(page).not.toContain("<b>\"");
    expect(page).toContain("TEST application &#60;b&#62;");

    const flip = await app.request("/admin/testers/mark", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" },
      body: "contact=stranger%40gmail.com&test=1",
    });
    expect(flip.status).toBe(303);
    expect(marks.mark("stranger@gmail.com")).toEqual({ test: true, byHand: true });
    const crossSite = await app.request("/admin/testers/mark", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "cross-site" },
      body: "contact=stranger%40gmail.com&test=0",
    });
    expect(crossSite.status).toBe(404);
    expect(marks.isTest("stranger@gmail.com")).toBe(true);
  });

  it("hides the operator page from everyone else", async () => {
    const { app, dataDir } = routes(false);
    expect((await app.request("/admin/testers")).status).toBe(404);
    expect((await app.request("/admin/testers/switch", { method: "POST", headers: { "sec-fetch-site": "same-origin" } })).status).toBe(404);
    expect(() => readFileSync(join(dataDir, TESTER_FLOW_FILE))).toThrow();
  });
});
