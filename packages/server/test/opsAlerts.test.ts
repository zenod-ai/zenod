import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountClientErrorReports, routeTemplate } from "../src/clientErrors.js";
import { opsAlertLine } from "../src/opsAlert.js";
import { TaskJobStore } from "../src/taskJobStore.js";
import { STUCK_SAVE_MS, TaskJobQueue } from "../src/taskJobQueue.js";
import { clientAddress } from "../src/zenodUnit.js";

// EPIC-24 M2: the `[ops-alert]` lines the health page's probe (docs/health/s1-live/probe.py) reads.
afterEach(() => vi.restoreAllMocks());

function warnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

describe("ops alert lines", () => {
  it("keeps fixed words and safe values only", () => {
    expect(opsAlertLine("signin", "callback_failed", { provider: "google", name: "Error" }))
      .toBe("[ops-alert] signin callback_failed provider=google name=Error");
    expect(opsAlertLine("app", "client_error", { page: "/app x\"<script>", status: undefined }))
      .toBe("[ops-alert] app client_error page=/app_x__script_");
  });
});

describe("client error reports (POST /api/public/client-error)", () => {
  function setup() {
    const app = new Hono<{ Bindings: HttpBindings }>();
    mountClientErrorReports(app, { clientAddress, now: () => new Date("2026-11-10T03:00:00Z") });
    const report = (body: unknown, address = "203.0.113.9") =>
      app.request("/api/public/client-error", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": address },
        body: JSON.stringify(body),
      });
    return { report };
  }

  it("logs the class, the route template and the status only", async () => {
    const warn = warnings();
    const { report } = setup();
    const res = await report({ kind: "api", name: "ApiError", page: "/app/memory/3f2a9c/notes?q=secret", api: "/api/note?path=Private/Diary.md", status: 502, message: "my diary says…" });
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toBe("[ops-alert] app client_api name=ApiError page=/app/memory/:id/notes api=/api/note status=502");
    expect(line).not.toContain("secret");
    expect(line).not.toContain("diary");
  });

  it("refuses unknown kinds and replaces odd class names", async () => {
    const warn = warnings();
    const { report } = setup();
    expect((await report({ kind: "spam" })).status).toBe(400);
    expect((await report({ kind: "error", name: "x y <b>", page: "https://evil.example/" })).status).toBe(204);
    expect(String(warn.mock.calls[0]![0])).toBe("[ops-alert] app client_error name=Error page=/");
  });

  it("stops logging past 20 reports from one address in 10 minutes", async () => {
    const warn = warnings();
    const { report } = setup();
    for (let i = 0; i < 25; i++) expect((await report({ kind: "error" })).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(20);
    await report({ kind: "error" }, "198.51.100.4");
    expect(warn).toHaveBeenCalledTimes(21);
  });

  it("turns ids into :id", () => {
    expect(routeTemplate("/app/chat")).toBe("/app/chat");
    expect(routeTemplate("/api/personas/weekly-recap/run")).toBe("/api/personas/weekly-recap/run");
    expect(routeTemplate("/x/usr_8a7/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/y/z")).toBe("/x/:id/:id/y");
    expect(routeTemplate(42)).toBe("/");
  });
});

describe("stuck saves", () => {
  it("logs one count-only line while a save waits over 15 minutes, and nothing once it is done", () => {
    const warn = warnings();
    const store = new TaskJobStore(join(mkdtempSync(join(tmpdir(), "zenod-stuck-")), "jobs.sqlite"), "t1");
    const queue = new TaskJobQueue(store, async () => { throw new Error("no engine in this test"); });
    const job = store.enqueue("store", { content: "a private note", source: "whatsapp" });
    expect(queue.checkStuckSaves(job.createdAt + STUCK_SAVE_MS - 60_000)).toBe(0);
    expect(queue.checkStuckSaves(job.createdAt + STUCK_SAVE_MS + 120_000)).toBe(1);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(["[ops-alert] save stuck n=1 oldest_min=17"]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
    const claimed = store.claimNextQueued()!;
    expect(store.updateClaimed(claimed, { status: "error", error: "x" })).toBe(true);
    expect(queue.checkStuckSaves(job.createdAt + STUCK_SAVE_MS + 300_000)).toBe(0);
  });
});
