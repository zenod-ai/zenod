import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EPAMINON_AGENT } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

describe("execution lane API", () => {
  let dir: string;
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-exec-lane-"));
    runtime = new Runtime(dir, EPAMINON_AGENT);
    runtime.settings.setRaw("exec_lane_secret", "lane-secret");
    runtime.settings.setRaw("backlog_repo", "owner/central");
    runtime.settings.setRaw("github_token", "ghp_test");
    app = createApp(runtime);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects event writes without the cross-provisioned lane secret", async () => {
    const bearerOnly = await app.request("/api/exec/event", {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.settings.apiToken()}` },
      body: JSON.stringify({ execution_id: 12, state: "running" }),
    });
    expect(bearerOnly.status).toBe(401);
  });

  it("applies an execution state event with the lane secret", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const method = init?.method ?? "GET";
      const path = String(url);
      if (method === "GET" && path.endsWith("/repos/owner/central/issues/12")) {
        return new Response(
          JSON.stringify({
            number: 12,
            html_url: "https://github.com/owner/central/issues/12",
            labels: [{ name: "type:execution" }, { name: "exec:queued" }],
          }),
          { status: 200 },
        );
      }
      if (method === "PUT" && path.endsWith("/repos/owner/central/issues/12/labels")) {
        expect(JSON.parse(String(init?.body))).toEqual({ labels: ["type:execution", "exec:running"] });
        return new Response(JSON.stringify([{ name: "type:execution" }, { name: "exec:running" }]), { status: 200 });
      }
      if (method === "POST" && path.endsWith("/repos/owner/central/issues/12/comments")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          body: "**exec:running** — https://example.test/pr/1 — worker launched",
        });
        return new Response(JSON.stringify({ id: 1 }), { status: 201 });
      }
      return new Response("unexpected", { status: 500 });
    });

    const res = await app.request("/api/exec/event", {
      method: "POST",
      headers: { "X-Lane-Secret": "lane-secret" },
      body: JSON.stringify({
        execution_id: 12,
        state: "running",
        evidence_url: "https://example.test/pr/1",
        note: "worker launched",
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      repo: "owner/central",
      executionId: 12,
      state: "running",
      changed: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("receives Archus execution dispatches idempotently into durable state", async () => {
    const first = await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: { "X-Lane-Secret": "lane-secret" },
      body: JSON.stringify({
        execution_id: 42,
        target: "owner/repo#7",
        context: "Objective: ship the thing",
      }),
    });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ ok: true });
    expect(runtime.executionStore.get("42")).toMatchObject({
      target: "owner/repo#7",
      context: "Objective: ship the thing",
      state: "running",
    });

    const second = await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: { "X-Lane-Secret": "lane-secret" },
      body: JSON.stringify({
        execution_id: 42,
        target: "owner/repo#7",
        context: "Objective: ship the thing",
      }),
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ ok: true });
  });
});
