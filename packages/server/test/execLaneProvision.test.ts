import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";
import { CONSOLE_AGENT, EPAMINON_AGENT, ZENOD_AGENT } from "../src/agent.js";

/**
 * #196 — the Console cross-provisions the Archus↔Epaminon execution lane. The pair is
 * provisioned one-shot, so the lane secret + each other's URL are pushed in place to
 * each (agent-token auth) once BOTH are enabled. See docs/EPAMINON-ARCHUS-PROTOCOL.md.
 */

describe("execution-lane config receiver (/api/agent/lane)", () => {
  let dir: string;
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-lane-recv-"));
    runtime = new Runtime(dir, EPAMINON_AGENT);
    app = createApp(runtime);
  });
  afterEach(async () => {
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("sets the lane secret + Archus URL on the executor (agent-token auth)", async () => {
    const token = runtime.settings.apiToken();
    const res = await app.request("/api/agent/lane", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ exec_lane_secret: "s3cr3t", peer_url: "http://zenod-archus2:8080" }),
    });
    expect(res.status).toBe(200);
    expect(runtime.settings.getRaw("exec_lane_secret")).toBe("s3cr3t");
    expect(runtime.settings.getRaw("exec_archus_url")).toBe("http://zenod-archus2:8080");
  });

  it("requires the agent token (401 without)", async () => {
    const res = await app.request("/api/agent/lane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exec_lane_secret: "s" }),
    });
    expect(res.status).toBe(401);
  });

  it("a non-participant (Zenod) refuses the lane config (400)", async () => {
    const d = await mkdtemp(join(tmpdir(), "zenod-lane-np-"));
    const rt = new Runtime(d, ZENOD_AGENT);
    const a = createApp(rt);
    const res = await a.request("/api/agent/lane", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${rt.settings.apiToken()}` },
      body: JSON.stringify({ exec_lane_secret: "s" }),
    });
    expect(res.status).toBe(400);
    rt.close();
    await rm(d, { recursive: true, force: true });
  });
});

describe("Console cross-provisions the lane when both agents are enabled (#196)", () => {
  let dir: string;
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-lane-prov-"));
    runtime = new Runtime(dir, CONSOLE_AGENT);
    runtime.settings.setRaw("anthropic_api_key", "sk-ant"); // activeApiKey for the enable gate
    app = createApp(runtime);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("pushes the same secret + each other's URL to both, on the enable that completes the pair", async () => {
    runtime.settings.setAgentToken("archus", "archus-tok"); // Archus already enabled
    runtime.settings.setAgentToken("epaminon", "epaminon-tok");
    runtime.settings.setPeers([{ name: "archus", url: "http://zenod-archus2:8080/mcp", token: "archus-tok" }]);

    const calls: Array<{ url: string; body: { exec_lane_secret?: string; peer_url?: string }; auth?: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown, init: { body?: string; headers?: Record<string, string> }) => {
      calls.push({ url: String(input), body: JSON.parse(init?.body ?? "{}"), auth: init?.headers?.Authorization });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch);

    const res = await app.request("/api/team/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${runtime.settings.apiToken()}` },
      body: JSON.stringify({ name: "epaminon" }),
    });
    expect(res.status).toBe(200);

    const laneCalls = calls.filter((c) => c.url.endsWith("/api/agent/lane"));
    expect(laneCalls.length).toBe(2);
    // one shared secret to both, and it matches what the Console stored
    const secrets = new Set(laneCalls.map((c) => c.body.exec_lane_secret));
    expect(secrets.size).toBe(1);
    expect([...secrets][0]).toBe(runtime.settings.getRaw("exec_lane_secret"));
    // each side learns the OTHER's URL, authenticated with that agent's token
    const toEpaminon = laneCalls.find((c) => c.url.startsWith("http://zenod-epaminon"));
    const toArchus = laneCalls.find((c) => c.url.startsWith("http://zenod-archus2"));
    expect(toEpaminon?.body.peer_url).toBe("http://zenod-archus2:8080");
    expect(toEpaminon?.auth).toBe("Bearer epaminon-tok");
    expect(toArchus?.body.peer_url).toBe("http://zenod-epaminon:8080");
    expect(toArchus?.auth).toBe("Bearer archus-tok");
  });

  it("does NOT provision the lane when only one of the pair is enabled", async () => {
    runtime.settings.setAgentToken("epaminon", "epaminon-tok"); // archus NOT enabled
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
      urls.push(String(input));
      return new Response("{}", { status: 200 });
    }) as typeof fetch);

    await app.request("/api/team/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${runtime.settings.apiToken()}` },
      body: JSON.stringify({ name: "epaminon" }),
    });
    expect(urls.filter((u) => u.endsWith("/api/agent/lane")).length).toBe(0);
    expect(runtime.settings.getRaw("exec_lane_secret")).toBeNull();
  });
});
