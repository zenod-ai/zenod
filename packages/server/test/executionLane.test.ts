import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";
import { EPAMINON_AGENT, ZENOD_AGENT } from "../src/agent.js";

/**
 * Epaminon's execution-lane receivers (Archus → Epaminon): the mirror of Archus's
 * /api/exec/event. Same cross-provisioned `exec_lane_secret` gate (NOT the agent
 * token), inert until provisioned, executor agents only. See
 * docs/EPAMINON-ARCHUS-PROTOCOL.md.
 */
describe("execution lane — Epaminon receivers", () => {
  let dir: string;
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;
  const SECRET = "lane-secret-xyz";
  const lane = (extra?: Record<string, string>) => ({ "Content-Type": "application/json", "X-Lane-Secret": SECRET, ...extra });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-execlane-"));
    runtime = new Runtime(dir, EPAMINON_AGENT);
    app = createApp(runtime);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("the executor has an execution queue; other agents do not", async () => {
    expect(runtime.executionQueue).not.toBeNull();
    const other = new Runtime(await mkdtemp(join(tmpdir(), "zenod-zenod-")), ZENOD_AGENT);
    expect(other.executionQueue).toBeNull();
    other.close();
  });

  it("is inert until the lane is provisioned (503)", async () => {
    const res = await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ execution_id: 7, target: "o/r#7", context: "do it" }),
    });
    expect(res.status).toBe(503);
  });

  it("rejects a wrong/absent lane secret once provisioned (401) — not the agent token", async () => {
    runtime.settings.setRaw("exec_lane_secret", SECRET);
    const noHeader = await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ execution_id: 7, target: "o/r#7" }),
    });
    expect(noHeader.status).toBe(401);
    const wrong = await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: lane({ "X-Lane-Secret": "nope" }),
      body: JSON.stringify({ execution_id: 7, target: "o/r#7" }),
    });
    expect(wrong.status).toBe(401);
  });

  it("enqueue → the ticket lands in the queue and runs (under the seam)", async () => {
    runtime.settings.setRaw("exec_lane_secret", SECRET);
    const res = await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: 42, target: "zenod-ai/zenod#42", context: "fix the bug" }),
    });
    expect(res.status).toBe(200);
    // The launch seam is a no-op stub (#194), so the ticket sits at running.
    const t = runtime.executionQueue!.get("42");
    expect(t?.target).toBe("zenod-ai/zenod#42");
    expect(t?.state).toBe("running");
  });

  it("enqueue requires execution_id and target (400)", async () => {
    runtime.settings.setRaw("exec_lane_secret", SECRET);
    const res = await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ context: "no id or target" }),
    });
    expect(res.status).toBe(400);
  });

  it("execution_status read returns the live queue (normal auth, not the lane path)", async () => {
    runtime.settings.setRaw("exec_lane_secret", SECRET);
    await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: 9, target: "o/r#9", context: "c" }),
    });
    const token = runtime.settings.apiToken();
    const res = await app.request("/api/executions", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tickets: Array<{ executionId: string }> };
    expect(body.tickets.map((t) => t.executionId)).toContain("9");
  });

  it("execution_status still returns terminal executions after a restart", async () => {
    runtime.settings.setRaw("exec_lane_secret", SECRET);
    await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: 10, target: "o/r#10", context: "c" }),
    });
    await runtime.executionQueue!.reportOutcome({
      executionId: "10",
      outward: false,
      evidenceUrl: "https://example.test/evidence",
      note: "finished smoke",
    });
    runtime.close();

    runtime = new Runtime(dir, EPAMINON_AGENT);
    app = createApp(runtime);
    const token = runtime.settings.apiToken();
    const res = await app.request("/api/executions", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { tickets: Array<{ executionId: string; state: string; evidenceUrl?: string; note?: string }> };
    expect(body.tickets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionId: "10",
          state: "done",
          evidenceUrl: "https://example.test/evidence",
          note: "finished smoke",
        }),
      ]),
    );
  });

  it("execution_status reconciles needs-review PR evidence to done once GitHub says the PR is merged", async () => {
    runtime.settings.setRaw("exec_lane_secret", SECRET);
    runtime.settings.setRaw("github_token", "gh-test-token");
    await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: 15, target: "zenod-ai/zenod#296", context: "c" }),
    });
    await app.request("/api/exec/outcome", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: 15, outward: true, evidence_url: "https://github.com/zenod-ai/zenod/pull/302" }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe("https://api.github.com/repos/zenod-ai/zenod/pulls/302");
        return new Response(JSON.stringify({ html_url: "https://github.com/zenod-ai/zenod/pull/302", state: "closed", merged: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const res = await app.request("/api/executions", { headers: { Authorization: `Bearer ${runtime.settings.apiToken()}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tickets: Array<{ executionId: string; state: string; evidenceUrl?: string }> };

    expect(body.tickets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionId: "15",
          state: "done",
          evidenceUrl: "https://github.com/zenod-ai/zenod/pull/302",
        }),
      ]),
    );
    expect(runtime.executionQueue!.get("15")?.state).toBe("done");
  });

  it("execution_status leaves needs-review PR evidence parked while the PR is still open", async () => {
    runtime.settings.setRaw("exec_lane_secret", SECRET);
    runtime.settings.setRaw("github_token", "gh-test-token");
    await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: 16, target: "zenod-ai/zenod#297", context: "c" }),
    });
    await app.request("/api/exec/outcome", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: 16, outward: true, evidence_url: "https://github.com/zenod-ai/zenod/pull/304" }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ html_url: "https://github.com/zenod-ai/zenod/pull/304", state: "open", merged: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const res = await app.request("/api/executions", { headers: { Authorization: `Bearer ${runtime.settings.apiToken()}` } });
    expect(res.status).toBe(200);

    expect(runtime.executionQueue!.get("16")?.state).toBe("needs-review");
  });

  it("approve on a ticket not awaiting review surfaces the illegal transition", async () => {
    runtime.settings.setRaw("exec_lane_secret", SECRET);
    await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: 5, target: "o/r#5", context: "c" }),
    });
    // #5 is at running (launch stub), not needs-review → approve is illegal → 500.
    const res = await app.request("/api/exec/approve", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: 5 }),
    });
    expect(res.status).toBe(500);
  });

  // The runner reports a dispatched run's result back (#194) — the queue advances.
  const dispatch = async (id: number) => {
    runtime.settings.setRaw("exec_lane_secret", SECRET);
    await app.request("/api/exec/enqueue", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: id, target: `o/r#${id}`, context: "c" }),
    });
  };

  it("outcome(outward) → the ticket parks at needs-review with its evidence", async () => {
    await dispatch(11);
    const res = await app.request("/api/exec/outcome", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: 11, outward: true, evidence_url: "https://pr/11" }),
    });
    expect(res.status).toBe(200);
    const t = runtime.executionQueue!.get("11");
    expect(t?.state).toBe("needs-review");
    expect(t?.evidenceUrl).toBe("https://pr/11");
  });

  it("outcome(internal) → the ticket completes at done", async () => {
    await dispatch(12);
    await app.request("/api/exec/outcome", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: 12, outward: false, evidence_url: "vault://note" }),
    });
    expect(runtime.executionQueue!.get("12")?.state).toBe("done");
  });

  it("blocked → the ticket parks at blocked with the note", async () => {
    await dispatch(13);
    await app.request("/api/exec/blocked", {
      method: "POST",
      headers: lane(),
      body: JSON.stringify({ execution_id: 13, note: "needs an API key" }),
    });
    const t = runtime.executionQueue!.get("13");
    expect(t?.state).toBe("blocked");
    expect(t?.note).toBe("needs an API key");
  });

  it("outcome/blocked require the lane secret (401)", async () => {
    await dispatch(14);
    const res = await app.request("/api/exec/outcome", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Lane-Secret": "wrong" },
      body: JSON.stringify({ execution_id: 14, outward: false }),
    });
    expect(res.status).toBe(401);
    expect(runtime.executionQueue!.get("14")?.state).toBe("running"); // untouched
  });
});
