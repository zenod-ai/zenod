import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalTaskingTools, PeerTools } from "zenod";
import { ARCHUS_AGENT, CONSOLE_AGENT } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { consolePeerConversationKey, formatConsolePeerDelegation, Runtime } from "../src/runtime.js";

describe("runtime tasking tools", () => {
  let dir: string;
  let runtime: Runtime;
  let runnerPokeUrl: string | undefined;

  beforeEach(async () => {
    runnerPokeUrl = process.env.ZENOD_RUNNER_POKE_URL;
    delete process.env.ZENOD_RUNNER_POKE_URL;
    dir = await mkdtemp(join(tmpdir(), "zenod-runtime-"));
    runtime = new Runtime(dir);
    runtime.settings.set("vault_repo", "zenod-ai/fixture");
    runtime.settings.set("github_token", "ghp_test");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (runnerPokeUrl === undefined) delete process.env.ZENOD_RUNNER_POKE_URL;
    else process.env.ZENOD_RUNNER_POKE_URL = runnerPokeUrl;
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("approveQueue adds owner:agent with status:queued so queued issues are visible to the runner", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const tools = (runtime as unknown as { buildTaskingTools(): ExternalTaskingTools }).buildTaskingTools();
    const result = await tools.approveQueue({ repo: "zenod-ai/fixture", issueNumbers: [54] });

    expect(result).toBe(
      "Queued #54 — poked the runner to start now (falls back to its poll).\n#54: https://github.com/zenod-ai/fixture/issues/54",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("/repos/zenod-ai/fixture/issues/54/labels/status%3Aproposed");
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[1]?.url).toContain("/repos/zenod-ai/fixture/issues/54/labels");
    expect(calls[1]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      labels: ["owner:agent", "status:queued"],
    });
  });

  it("createIssue returns the direct GitHub issue URL from the API response", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ number: 82, html_url: "https://github.com/zenod-ai/fixture/issues/82" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const tools = (runtime as unknown as { buildTaskingTools(): ExternalTaskingTools }).buildTaskingTools();
    const result = await tools.createIssue({ title: "Test issue", body: "## Objective\nTest", labels: ["owner:agent"] });

    expect(result).toBe("Created issue #82: https://github.com/zenod-ai/fixture/issues/82");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/repos/zenod-ai/fixture/issues");
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("queryBacklog resolves explicit mixed issue and PR ids instead of fuzzy-searching only open issues", async () => {
    runtime.settings.setRaw("backlog_repo", "AlfaBlok/obsidian-brain");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        const path = String(url).replace("https://api.github.com", "");
        if (path === "/repos/AlfaBlok/obsidian-brain/issues/108") {
          return new Response(
            JSON.stringify({
              number: 108,
              title: "Produce Backlog System Plan",
              body: "## Objective\nProduce the plan.",
              state: "open",
              html_url: "https://github.com/AlfaBlok/obsidian-brain/issues/108",
              updated_at: "2026-06-20T14:29:00Z",
              labels: [{ name: "owner:agent" }, { name: "status:needs-review" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (path === "/repos/AlfaBlok/obsidian-brain/issues/108/comments?per_page=20") {
          return new Response(
            JSON.stringify([{ body: "Recovered draft PR: https://github.com/AlfaBlok/obsidian-brain/pull/110" }]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (path === "/repos/AlfaBlok/obsidian-brain/pulls/110") {
          return new Response(
            JSON.stringify({
              number: 110,
              title: "Fix #108: Produce Backlog System Plan",
              state: "open",
              html_url: "https://github.com/AlfaBlok/obsidian-brain/pull/110",
              updated_at: "2026-06-20T14:30:00Z",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(`unexpected ${init.method ?? "GET"} ${url}`, { status: 500 });
      }),
    );

    const tools = (runtime as unknown as { buildTaskingTools(): ExternalTaskingTools }).buildTaskingTools();
    const result = await tools.queryBacklog(
      "Re-check status of tickets #108 and PR #110 in AlfaBlok/obsidian-brain; provide output links.",
    );

    expect(result).toContain("Issue lookup matching");
    expect(result).toContain("AlfaBlok/obsidian-brain#108 Issue: Produce Backlog System Plan");
    expect(result).toContain("status:needs-review");
    expect(result).toContain("Recovered draft PR: https://github.com/AlfaBlok/obsidian-brain/pull/110");
    expect(result).toContain("AlfaBlok/obsidian-brain#110 Pull request: Fix #108: Produce Backlog System Plan");
    expect(calls.map((call) => call.url).sort()).toEqual([
      "https://api.github.com/repos/AlfaBlok/obsidian-brain/issues/108",
      "https://api.github.com/repos/AlfaBlok/obsidian-brain/issues/108/comments?per_page=20",
      "https://api.github.com/repos/AlfaBlok/obsidian-brain/pulls/110",
    ].sort());
  });

  it("exposes typed Archus issue reads to Console peer tools", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (!String(url).startsWith("https://api.github.com/")) return originalFetch(url, init);
        calls.push(String(url));
        const path = String(url).replace("https://api.github.com", "");
        if (path === "/repos/AlfaBlok/obsidian-brain/issues/108") {
          return new Response(
            JSON.stringify({
              number: 108,
              title: "Produce Backlog System Plan",
              body: "## Objective\nProduce the plan.",
              state: "open",
              html_url: "https://github.com/AlfaBlok/obsidian-brain/issues/108",
              created_at: "2026-06-19T11:00:00Z",
              updated_at: "2026-06-20T14:29:00Z",
              labels: [{ name: "owner:agent" }, { name: "status:needs-review" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (path === "/repos/AlfaBlok/obsidian-brain/issues/108/comments?per_page=20") {
          return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(`unexpected ${url}`, { status: 500 });
      }),
    );

    const archusDir = await mkdtemp(join(tmpdir(), "zenod-runtime-archus-"));
    const consoleDir = await mkdtemp(join(tmpdir(), "zenod-runtime-console-"));
    let archusServer: ServerType | undefined;
    const archusRuntime = new Runtime(archusDir, ARCHUS_AGENT);
    const consoleRuntime = new Runtime(consoleDir, CONSOLE_AGENT);
    try {
      archusRuntime.settings.setRaw("backlog_repo", "AlfaBlok/obsidian-brain");
      archusRuntime.settings.setRaw("github_token", "ghp_test");
      const archusApp = createApp(archusRuntime);
      archusServer = serve({ fetch: archusApp.fetch, port: 0 });
      const archusPort = (archusServer.address() as AddressInfo).port;
      consoleRuntime.settings.setPeers([
        {
          name: "archus",
          url: `http://127.0.0.1:${archusPort}/mcp`,
          token: archusRuntime.settings.apiToken(),
          tools: [
            {
              as: "archus_read_exact_github_issue",
              mcp: "archus.get_issue",
              arg: "target",
              inputSchema: "archus.get_issue",
              description: "Owner: Archus. Read ONE exact GitHub issue.",
            },
          ],
        },
      ]);

      const tools = (consoleRuntime as unknown as { buildPeerTools(): PeerTools }).buildPeerTools();
      expect(tools.archus_read_exact_github_issue.inputSchema).toBeDefined();
      const result = await tools.archus_read_exact_github_issue.run({ target: "AlfaBlok/obsidian-brain#108" });

      expect(result).toContain("AlfaBlok/obsidian-brain#108");
      expect(result).toContain("Produce Backlog System Plan");
      expect(result).toContain("state: open");
      expect(result).toContain("https://github.com/AlfaBlok/obsidian-brain/issues/108");
      expect(calls).toContain("https://api.github.com/repos/AlfaBlok/obsidian-brain/issues/108");
    } finally {
      archusServer?.close();
      archusRuntime.close();
      consoleRuntime.close();
      await rm(archusDir, { recursive: true, force: true });
      await rm(consoleDir, { recursive: true, force: true });
    }
  });

  it("queueExecution hydrates the target issue before minting and dispatching", async () => {
    runtime.settings.setRaw("backlog_repo", "owner/central");
    runtime.settings.setRaw("exec_lane_secret", "lane-secret");
    runtime.settings.setRaw("epaminon_base_url", "http://epaminon.test");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        const path = String(url).replace("https://api.github.com", "");
        if (path === "/repos/zenod-ai/fixture/issues/103" && !init.method) {
          return new Response(
            JSON.stringify({
              number: 103,
              title: "Fusion spike",
              body: [
                "## Objective",
                "Investigate the fusion path in packages/server/src/runtime.ts.",
                "## Scope",
                "Only inspect execution plumbing.",
                "## Acceptance criteria",
                "- Document the result.",
                "## Source context",
                "- https://github.com/zenod-ai/zenod/issues/103",
              ].join("\n"),
              html_url: "https://github.com/zenod-ai/fixture/issues/103",
              labels: [{ name: "owner:agent" }, { name: "status:proposed" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (path === "/repos/owner/central/issues" && init.method === "POST") {
          const body = JSON.parse(String(init.body));
          expect(body.body).toContain("Target URL: https://github.com/zenod-ai/fixture/issues/103");
          expect(body.body).toContain("Archus run note:");
          expect(body.body).toContain("Target issue body:");
          return new Response(JSON.stringify({ number: 104, html_url: "https://github.com/owner/central/issues/104" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (String(url) === "http://epaminon.test/api/exec/enqueue" && init.method === "POST") {
          const body = JSON.parse(String(init.body));
          expect(body).toMatchObject({
            execution_id: 104,
            target: "zenod-ai/fixture#103",
          });
          expect(body.context).toContain("Target issue body:");
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(`unexpected ${init.method ?? "GET"} ${url}`, { status: 500 });
      }),
    );

    const tools = (runtime as unknown as { buildTaskingTools(): ExternalTaskingTools }).buildTaskingTools();
    const result = await tools.queueExecution({
      target: "zenod-ai/fixture#103",
      title: "Run fixture#103",
      context: "Start this now.",
      repo: "owner/central",
    });

    expect(result).toContain("Minted execution ticket owner/central#104");
    expect(result).toContain("and dispatched to Epaminon");
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/repos/zenod-ai/fixture/issues/103",
      "https://api.github.com/repos/owner/central/issues",
      "http://epaminon.test/api/exec/enqueue",
    ]);
  });

  it("queueExecution refuses to mint when the target issue is not runnable", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            number: 103,
            title: "Fusion spike",
            body: "Vague spike with no runnable details.",
            html_url: "https://github.com/zenod-ai/fixture/issues/103",
            labels: [{ name: "status:proposed" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const tools = (runtime as unknown as { buildTaskingTools(): ExternalTaskingTools }).buildTaskingTools();
    await expect(
      tools.queueExecution({
        target: "zenod-ai/fixture#103",
        title: "Run fixture#103",
        context: "Start this now.",
      }),
    ).rejects.toThrow(/missing owner:agent label.*missing acceptance criteria.*missing scope.*missing source context/);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.github.com/repos/zenod-ai/fixture/issues/103");
  });
});

describe("Console peer delegation context", () => {
  it("derives a stable peer conversation key from the parent Console thread", () => {
    expect(consolePeerConversationKey("web:default", "archus")).toBe("web-default-archus");
  });

  it("formats a bounded recent-thread excerpt with speaker labels", () => {
    const text = formatConsolePeerDelegation("what is blocked?", {
      parentConversationId: "web:default",
      peerName: "archus",
      messages: [
        { role: "user", surface: "web", text: "epaminon what's your status?", at: new Date("2026-06-17T18:00:00Z") },
        {
          role: "assistant",
          surface: "web",
          text: "Epaminon: No Fusion tickets currently dispatched on my side.",
          at: new Date("2026-06-17T18:00:01Z"),
        },
      ],
    });

    expect(text).toContain("Parent Console conversation: web:default");
    expect(text).toContain("user: epaminon what's your status?");
    expect(text).toContain("Console: Epaminon: No Fusion tickets currently dispatched on my side.");
    expect(text).toContain("Current request to archus:\nwhat is blocked?");
    expect(text).toContain("not durable memory");
  });
});
