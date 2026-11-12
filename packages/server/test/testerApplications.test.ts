import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import { mountTesterApplications, TESTER_APPLICATIONS_FILE } from "../src/testerApplications.js";
import { LINK_SHOWN, localMinter, TesterFlow } from "../src/testerFlow.js";
import { clientAddress } from "../src/zenodUnit.js";

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "zenod-testers-"));
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountTesterApplications(app, { dataDir, clientAddress, now: () => new Date("2026-11-09T05:00:00Z") });
  const apply = (body: unknown, address = "203.0.113.7") =>
    app.request("/api/public/testers/apply", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": address },
      body: JSON.stringify(body),
    });
  const kept = () => {
    const path = join(dataDir, TESTER_APPLICATIONS_FILE);
    return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  return { dataDir, apply, kept };
}

describe("zenod.dev/testers apply form (ZAL-A13)", () => {
  it("keeps an application in a private file with the answer, the contact and the time only", async () => {
    const { dataDir, apply, kept } = setup();
    const response = await apply({ use: "  Voice notes on my walks,\n and Claude Code saving lessons. ", contact: "me@example.com", website: "" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(kept()).toEqual([{ at: "2026-11-09T05:00:00.000Z", use: "Voice notes on my walks, and Claude Code saving lessons.", contact: "me@example.com" }]);
    expect(statSync(join(dataDir, TESTER_APPLICATIONS_FILE)).mode & 0o077).toBe(0);
    expect(readFileSync(join(dataDir, TESTER_APPLICATIONS_FILE), "utf8")).not.toContain("203.0.113.7");
  });

  it("answers a filled honeypot as if kept, and keeps nothing", async () => {
    const { apply, kept } = setup();
    const response = await apply({ use: "Buy cheap watches online today", contact: "bot@example.com", website: "http://spam.example" });
    expect(response.status).toBe(200);
    expect(kept()).toEqual([]);
  });

  it("refuses an empty answer or contact", async () => {
    const { apply, kept } = setup();
    expect((await apply({ use: "hi", contact: "me@example.com" })).status).toBe(400);
    expect((await apply({ use: "Voice notes on my walks", contact: "" })).status).toBe(400);
    expect((await apply({ use: "x".repeat(2001), contact: "me@example.com" })).status).toBe(400);
    expect(kept()).toEqual([]);
  });

  it("limits each address to five an hour", async () => {
    const { apply, kept } = setup();
    for (let index = 0; index < 5; index += 1)
      expect((await apply({ use: `Voice notes, attempt ${index}`, contact: "me@example.com" })).status).toBe(200);
    const limited = await apply({ use: "Voice notes, attempt 6", contact: "me@example.com" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3600");
    expect((await apply({ use: "Voice notes from someone else", contact: "you@example.com" }, "198.51.100.2")).status).toBe(200);
    expect(kept()).toHaveLength(6);
  });

  it("with the tester flow on, asks for an email and answers accepted or waitlist (EPIC-26 S2)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "zenod-testers-flow-"));
    const flow = new TesterFlow({ dataDir, cap: 1 });
    const app = new Hono<{ Bindings: HttpBindings }>();
    mountTesterApplications(app, { dataDir, clientAddress, flow });
    const apply = (contact: string) =>
      app.request("/api/public/testers/apply", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({ use: "Voice notes on my walks", contact }),
      });
    const handle = await apply("u/my_reddit");
    expect(handle.status).toBe(400);
    expect(await handle.json()).toEqual({ error: expect.stringMatching(/email/) });
    expect(await (await apply("first@example.com")).json()).toEqual({ ok: true, status: "accepted", claim: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/) });
    expect(await (await apply("second@example.com")).json()).toEqual({ ok: true, status: "waitlist" });
    expect(flow.snapshot().testers.map((t) => t.email)).toEqual(["first@example.com", "second@example.com"]);
  });

  it("shows a person accepted just now their personal link, never on a repeat (EPIC-23 U7)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "zenod-testers-link-"));
    const flow = new TesterFlow({ dataDir, cap: 5, mint: localMinter });
    const app = new Hono<{ Bindings: HttpBindings }>();
    mountTesterApplications(app, { dataDir, clientAddress, flow });
    const apply = (contact: string) =>
      app.request("/api/public/testers/apply", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
        body: JSON.stringify({ use: "Voice notes on my walks", contact }),
      });
    const first = (await (await apply("first@example.com")).json()) as { status: string; code: string; link: string };
    expect(first.status).toBe("accepted");
    expect(first.code).toMatch(/^ZT-/);
    expect(first.link).toBe(`https://cloud.zenod.dev/join?code=${first.code}`);
    expect(await (await apply("first@example.com")).json()).toEqual({ ok: true, status: "accepted", again: true });
  });

  it("gives the applicant's browser a private key that shows only their own link again (E26-S11 iteration 4)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "zenod-testers-claim-"));
    const flow = new TesterFlow({ dataDir, cap: 5, mint: localMinter });
    const app = new Hono<{ Bindings: HttpBindings }>();
    mountTesterApplications(app, { dataDir, clientAddress, flow });
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
        body: JSON.stringify(body),
      });
    const first = (await (await post("/api/public/testers/apply", { use: "Voice notes on my walks", contact: "first@example.com" })).json()) as {
      link: string;
      claim: string;
    };
    const second = (await (await post("/api/public/testers/apply", { use: "Voice notes on my walks", contact: "second@example.com" })).json()) as {
      link: string;
      claim: string;
    };
    expect(first.claim).not.toBe(second.claim);
    expect(await (await post("/api/public/testers/link", { claim: first.claim })).json()).toEqual({ ok: true, link: first.link });
    expect(await (await post("/api/public/testers/link", { claim: second.claim })).json()).toEqual({ ok: true, link: second.link });
    expect((await post("/api/public/testers/link", { claim: "A".repeat(32) })).status).toBe(404);
    expect((await post("/api/public/testers/link", { claim: "" })).status).toBe(404);
    expect((await post("/api/public/testers/link", {})).status).toBe(404);
    // Only the hash is kept on the server, never the key itself.
    expect(readFileSync(join(dataDir, "tester-flow.json"), "utf8")).not.toContain(first.claim);
    // No mail sender: once the link was on screen, nothing waits on mail.
    expect(flow.snapshot().testers[0]).toMatchObject({ waiting: LINK_SHOWN });
  });
});
