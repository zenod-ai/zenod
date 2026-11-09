import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import { mountTesterApplications, TESTER_APPLICATIONS_FILE } from "../src/testerApplications.js";
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
});
