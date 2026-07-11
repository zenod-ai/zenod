import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type Stripe from "stripe";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine } from "zenod";
import { CONSOLE_AGENT, HERALD_AGENT } from "../src/agent.js";
import type { CustomerStripeClient } from "../src/customerBilling.js";
import { createHeraldUnit } from "../src/heraldUnit.js";
import { resolveServerMode } from "../src/serverMode.js";
import { PeerSkillStore } from "../src/peerSkillStore.js";

const dirs: string[] = [];
const MASTER_KEY = "22".repeat(32);

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Herald council unit", () => {
  it("ports the Console persona and selects Herald mode explicitly", () => {
    expect(HERALD_AGENT.persona).toBe(CONSOLE_AGENT.persona);
    expect(resolveServerMode({ ZENOD_UNIT: "herald" }, HERALD_AGENT.name)).toBe("herald");
  });

  it("serves the Herald landing on its canonical host and the customer app at /app", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "herald-static-"));
    dirs.push(dataDir);
    const siteDist = join(dataDir, "site");
    const webDist = join(dataDir, "web");
    await mkdir(siteDist);
    await mkdir(webDist);
    await writeFile(join(siteDist, "index.html"), "HERALD LANDING");
    await writeFile(join(webDist, "index.html"), "HERALD APP");
    const unit = createHeraldUnit({
      dataDir: join(dataDir, "data"),
      siteDist,
      webDist,
      tenantStore: createMemoryTenantStore(),
      env: { CHASSIS_VAULT_MASTER_KEY: MASTER_KEY },
    });
    try {
      expect(await (await unit.app.request("/", { headers: { host: "herald.zenod.dev" } })).text())
        .toContain("HERALD LANDING");
      expect(await (await unit.app.request("/app", { headers: { host: "herald.zenod.dev" } })).text())
        .toContain("HERALD APP");
    } finally {
      unit.close();
    }
  });

  it("keeps Council keys, settings and overview tenant-scoped", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "herald-unit-"));
    dirs.push(dataDir);
    const tenants = createMemoryTenantStore([
      { token: "alpha-token", tenant: { id: "tenant-alpha", name: "Alpha" } },
      { token: "beta-token", tenant: { id: "tenant-beta", name: "Beta" } },
    ]);
    const unit = createHeraldUnit({
      dataDir,
      tenantStore: tenants,
      env: { CHASSIS_VAULT_MASTER_KEY: MASTER_KEY },
    });
    try {
      const save = await unit.app.request("/api/settings", {
        method: "PUT",
        headers: {
          authorization: "Bearer alpha-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ provider: "openrouter", openrouter_api_key: "sk-or-alpha" }),
      });
      expect(save.status).toBe(200);

      const alpha = await unit.app.request("/api/settings?tenantId=tenant-beta", {
        headers: { authorization: "Bearer alpha-token" },
      });
      const beta = await unit.app.request("/api/settings", {
        headers: { authorization: "Bearer beta-token" },
      });
      expect(await alpha.json()).toMatchObject({
        settings: { provider: "openrouter", openrouter_api_key: expect.stringContaining("•") },
      });
      expect(JSON.stringify(await beta.json())).not.toContain("sk-or-alpha");

      const overview = await unit.app.request("/api/overview", {
        headers: { authorization: "Bearer alpha-token" },
      });
      expect(await overview.json()).toMatchObject({
        tenant: { id: "tenant-alpha" },
        unit: { name: "herald" },
        panels: ["chat", "briefing", "board", "keys", "connections", "costs", "mcp"],
      });

      const briefing = await unit.app.request("/api/herald/briefing", {
        headers: { authorization: "Bearer alpha-token" },
      });
      expect(await briefing.json()).toEqual({ briefing: null });
      const board = await unit.app.request("/api/herald/board", {
        headers: { authorization: "Bearer alpha-token" },
      });
      expect(await board.json()).toEqual({ items: [], wakes: [] });
      const refused = await unit.app.request("/api/herald/run-now", {
        method: "POST",
        headers: { authorization: "Bearer alpha-token" },
      });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ code: "briefing_required", status: "refused" });

      const setup = await unit.app.request("/api/chat/stream", {
        method: "POST",
        headers: { authorization: "Bearer alpha-token", "content-type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });
      expect(setup.status).toBe(200);
      const setupBody = await setup.text();
      expect(setupBody).toContain("Briefing setup started");
      expect(setupBody).toContain('"type":"done"');
      const setupHistory = await unit.app.request("/api/chat/history", {
        headers: { authorization: "Bearer alpha-token" },
      });
      const setupHistoryPayload = await setupHistory.json() as { messages: Array<{ role: string; text: string }> };
      expect(setupHistoryPayload.messages.slice(-2)).toMatchObject([
          { role: "user", text: "hello" },
          { role: "assistant", text: expect.stringContaining("No loop action can run before approval") },
      ]);

      const runtime = unit.runtimes.get("tenant-alpha");
      expect(runtime).not.toBeNull();
      runtime!.getEngine = async () => ({
        async chat(message) {
          return { text: `Council reply: ${message}`, sources: [] };
        },
      }) as BrainEngine;

      const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
        const started = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(started));
      });
      const address = server.address() as AddressInfo;
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${address.port}/mcp/alpha-token`),
      );
      const client = new Client({ name: "herald-external-test", version: "1" });
      await client.connect(transport);
      expect(client.getServerVersion()).toMatchObject({ name: "herald" });
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "get_board",
        "get_briefing",
        "propose_now",
        "approve_items",
      ]));

      const chat = await client.callTool({
        name: "chat_with_herald",
        arguments: { message: "is the council available?" },
      });
      expect(chat.isError).not.toBe(true);
      expect(chat.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "text", text: expect.stringContaining("Council reply: is the council available?") }),
      ]));
      expect(chat.structuredContent).toMatchObject({
        status: "ok",
        text: "Council reply: is the council available?",
        evidence: [{ kind: "chat_audit", id: expect.stringMatching(/^test_/), conversationId: expect.any(String) }],
      });
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } finally {
      unit.close();
    }
  });

  it("keeps My Units and downstream credentials tenant-scoped", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "herald-wallet-"));
    dirs.push(dataDir);
    const tenants = createMemoryTenantStore([
      { token: "herald-alpha", tenant: { id: "tenant-alpha", name: "Alpha" } },
      { token: "herald-beta", tenant: { id: "tenant-beta", name: "Beta" } },
    ]);
    const unit = createHeraldUnit({
      dataDir,
      tenantStore: tenants,
      env: {
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        RING_UNIT_FLEET_ALLOWLIST: "alpha-zenod.internal",
      },
    });
    try {
      const saved = await unit.app.request("/api/peers", {
        method: "PUT",
        headers: { authorization: "Bearer herald-alpha", "content-type": "application/json" },
        body: JSON.stringify({ peers: [{ name: "Zenod", url: "https://alpha-zenod.internal/mcp", token: "downstream-alpha" }] }),
      });
      expect(saved.status).toBe(200);
      const savedPayload = await saved.json() as { peers: Array<Record<string, unknown>> };
      expect(savedPayload).toMatchObject({
        peers: [{ name: "Zenod", hasToken: true, status: "error" }],
      });
      expect(savedPayload.peers[0]).not.toHaveProperty("tool");

      const alpha = await unit.app.request("/api/peers", { headers: { authorization: "Bearer herald-alpha" } });
      const beta = await unit.app.request("/api/peers?tenantId=tenant-alpha", { headers: { authorization: "Bearer herald-beta" } });
      const alphaPayload = await alpha.json() as { peers: Array<Record<string, unknown>> };
      expect(alphaPayload).toMatchObject({ peers: [{ name: "Zenod", hasToken: true }] });
      expect(alphaPayload.peers[0]).not.toHaveProperty("tool");
      expect(await beta.json()).toEqual({ peers: [] });

      const denied = await unit.app.request("/api/peers", {
        method: "PUT",
        headers: { authorization: "Bearer herald-beta", "content-type": "application/json" },
        body: JSON.stringify({ peers: [{ name: "bad", url: "https://127.0.0.1/mcp", token: "secret" }] }),
      });
      expect(denied.status).toBe(400);
    } finally {
      unit.close();
    }
  });

  it("attaches, replaces, downloads and detaches peer skills within one tenant and peer", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "herald-peer-skill-"));
    dirs.push(dataDir);
    const tenants = createMemoryTenantStore([
      { token: "herald-alpha", tenant: { id: "tenant-alpha", name: "Alpha" } },
      { token: "herald-beta", tenant: { id: "tenant-beta", name: "Beta" } },
    ]);
    const unit = createHeraldUnit({
      dataDir,
      tenantStore: tenants,
      env: {
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        RING_UNIT_FLEET_ALLOWLIST: "alpha-unit.internal,beta-unit.internal",
      },
    });
    const headers = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
    const bundle = (version: string, workflow: string) => ({
      files: [
        {
          path: "SKILL.md",
          content: `---\nname: portable-peer\ndescription: Portable peer operating instructions.\nmetadata:\n  version: "${version}"\n---\n\n# Portable peer\n`,
        },
        { path: "references/WORKFLOW.md", content: workflow },
        { path: "scripts/inert.sh", content: "exit 1\n" },
      ],
    });
    try {
      for (const [token, host] of [["herald-alpha", "alpha-unit.internal"], ["herald-beta", "beta-unit.internal"]]) {
        const saved = await unit.app.request("/api/peers", {
          method: "PUT",
          headers: headers(token!),
          body: JSON.stringify({ peers: [
            { name: "Calli", url: `https://${host}/mcp`, token: `downstream-${token}` },
            { name: "Other", url: `https://${host}/other`, token: `other-${token}` },
          ] }),
        });
        expect(saved.status).toBe(200);
      }

      const attached = await unit.app.request("/api/peers/Calli/skill", {
        method: "PUT",
        headers: headers("herald-alpha"),
        body: JSON.stringify(bundle("1.0.0", "first workflow")),
      });
      expect(attached.status).toBe(200);
      const first = await attached.json() as { attachment: { artifactId: string; version: string } };
      expect(first.attachment).toMatchObject({ version: "1.0.0" });
      expect(JSON.stringify(first)).not.toContain("downstream-herald-alpha");

      const peerList = await unit.app.request("/api/peers", {
        headers: { authorization: "Bearer herald-alpha" },
      });
      expect(await peerList.json()).toMatchObject({
        peers: [
          {
            name: "Calli",
            skill: {
              artifactId: first.attachment.artifactId,
              version: "1.0.0",
              name: "portable-peer",
              description: "Portable peer operating instructions.",
              scriptsInert: true,
            },
          },
          { name: "Other", skill: null },
        ],
      });

      const editedPeers = await unit.app.request("/api/peers", {
        method: "PUT",
        headers: headers("herald-alpha"),
        body: JSON.stringify({ peers: [
          { name: "Calli", url: "https://alpha-unit.internal/mcp", token: "••••••••" },
          { name: "Other", url: "https://alpha-unit.internal/other", token: "••••••••" },
        ] }),
      });
      expect(await editedPeers.json()).toMatchObject({
        peers: [
          { name: "Calli", skill: { artifactId: first.attachment.artifactId, version: "1.0.0" } },
          { name: "Other", skill: null },
        ],
      });

      const betaInspect = await unit.app.request("/api/peers/Calli/skill?tenantId=tenant-alpha", {
        headers: { authorization: "Bearer herald-beta" },
      });
      expect(await betaInspect.json()).toEqual({ attachment: null });
      const otherInspect = await unit.app.request("/api/peers/Other/skill", {
        headers: { authorization: "Bearer herald-alpha" },
      });
      expect(await otherInspect.json()).toEqual({ attachment: null });

      const replaced = await unit.app.request("/api/peers/Calli/skill", {
        method: "PUT",
        headers: headers("herald-alpha"),
        body: JSON.stringify(bundle("2.0.0", "replacement workflow")),
      });
      const second = await replaced.json() as { attachment: { artifactId: string; version: string } };
      expect(second.attachment.version).toBe("2.0.0");
      expect(second.attachment.artifactId).not.toBe(first.attachment.artifactId);

      const downloaded = await unit.app.request("/api/peers/Calli/skill/download", {
        headers: { authorization: "Bearer herald-alpha" },
      });
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers.get("content-type")).toContain("application/vnd.zenod.agent-skill+json");
      const archive = await downloaded.json() as { artifact: { artifactId: string }; files: Array<{ path: string; contentBase64: string }> };
      expect(archive.artifact.artifactId).toBe(second.attachment.artifactId);
      expect(Buffer.from(archive.files.find((file) => file.path === "references/WORKFLOW.md")!.contentBase64, "base64").toString())
        .toBe("replacement workflow");

      const detached = await unit.app.request("/api/peers/Calli/skill", {
        method: "DELETE",
        headers: { authorization: "Bearer herald-alpha" },
      });
      expect(await detached.json()).toEqual({ attachment: null });
      const afterDetach = await unit.app.request("/api/peers/Calli/skill", {
        headers: { authorization: "Bearer herald-alpha" },
      });
      expect(await afterDetach.json()).toEqual({ attachment: null });
    } finally {
      unit.close();
    }
  });

  it("does not resurrect a peer deleted while its skill upload is in flight", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "herald-peer-skill-race-"));
    dirs.push(dataDir);
    const tenants = createMemoryTenantStore([
      { token: "herald-alpha", tenant: { id: "tenant-alpha", name: "Alpha" } },
    ]);
    const unit = createHeraldUnit({
      dataDir,
      tenantStore: tenants,
      env: { CHASSIS_VAULT_MASTER_KEY: MASTER_KEY, RING_UNIT_FLEET_ALLOWLIST: "alpha-unit.internal" },
    });
    const headers = { authorization: "Bearer herald-alpha", "content-type": "application/json" };
    const originalPut = PeerSkillStore.prototype.put;
    let releaseUpload!: () => void;
    let uploadEntered!: () => void;
    const uploadGate = new Promise<void>((resolve) => { releaseUpload = resolve; });
    const entered = new Promise<void>((resolve) => { uploadEntered = resolve; });
    const putSpy = vi.spyOn(PeerSkillStore.prototype, "put").mockImplementation(async function (files) {
      uploadEntered();
      await uploadGate;
      return originalPut.call(this, files);
    });
    try {
      const saved = await unit.app.request("/api/peers", {
        method: "PUT",
        headers,
        body: JSON.stringify({ peers: [
          { name: "Calli", url: "https://alpha-unit.internal/mcp", token: "downstream-alpha" },
        ] }),
      });
      expect(saved.status).toBe(200);

      const attaching = unit.app.request("/api/peers/Calli/skill", {
        method: "PUT",
        headers,
        body: JSON.stringify({ files: [{
          path: "SKILL.md",
          content: "---\nname: calli\ndescription: Safe outbound peer.\n---\n",
        }] }),
      });
      await entered;
      const deleted = await unit.app.request("/api/peers", {
        method: "PUT",
        headers,
        body: JSON.stringify({ peers: [] }),
      });
      expect(deleted.status).toBe(200);
      releaseUpload();

      expect((await attaching).status).toBe(409);
      const peers = await unit.app.request("/api/peers", { headers: { authorization: "Bearer herald-alpha" } });
      expect(await peers.json()).toEqual({ peers: [] });
    } finally {
      releaseUpload();
      putSpy.mockRestore();
      unit.close();
    }
  });

  it("uses the Herald namespace, checkout metadata, domain and default OAuth callback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "herald-customer-"));
    dirs.push(dataDir);
    let created: Stripe.Checkout.SessionCreateParams | null = null;
    const checkoutSession = {
      id: "cs_herald",
      object: "checkout.session",
      client_reference_id: "github-42",
      metadata: { product: "herald", unit: "herald" },
      mode: "subscription",
      payment_status: "unpaid",
      status: "open",
      url: "https://checkout.stripe.test/herald",
    } as Stripe.Checkout.Session;
    const stripe: CustomerStripeClient = {
      checkout: {
        sessions: {
          create: vi.fn(async (params) => {
            created = params;
            return checkoutSession;
          }),
          retrieve: vi.fn(async () => checkoutSession),
        },
      },
      webhooks: { constructEvent: vi.fn() },
    };
    const env = {
      NODE_ENV: "test",
      ACCOUNT_STATE_SECRET: "herald-state-secret",
      GITHUB_OAUTH_CLIENT_ID: "herald-client",
      GITHUB_OAUTH_CLIENT_SECRET: "herald-client-secret",
      CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
      PRICE_MONTHLY: "price_herald_monthly",
    };
    const tenants = createMemoryTenantStore();
    const unit = createHeraldUnit({
      dataDir,
      tenantStore: tenants,
      env,
      customer: {
        stripe,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "herald-owner", email: null }),
        },
      },
    });
    try {
      expect(unit.customerAccounts.path).toBe(join(dataDir, "customer-accounts-herald.json"));
      const signIn = await unit.app.request("/auth/signin", {
        headers: { host: "herald.zenod.dev" },
      });
      const state = new URL(signIn.headers.get("location")!).searchParams.get("state")!;
      const callback = await unit.app.request(
        `/auth/github/callback?code=ok&state=${encodeURIComponent(state)}`,
      );
      expect(callback.headers.get("location")).toBe("https://herald.zenod.dev/");
      const cookie = callback.headers.get("set-cookie")!.split(";")[0]!;
      const checkout = await unit.app.request("/create-checkout-session", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ tier: "monthly" }),
      });
      expect(checkout.status).toBe(200);
      expect(created).toMatchObject({
        client_reference_id: "github-42",
        metadata: { product: "herald", unit: "herald" },
        success_url: "https://herald.zenod.dev/checkout/complete?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://herald.zenod.dev/pricing?checkout=cancelled",
      });
    } finally {
      unit.close();
    }

    const callbackUnit = createHeraldUnit({ dataDir: `${dataDir}-callback`, env });
    dirs.push(`${dataDir}-callback`);
    try {
      const signIn = await callbackUnit.app.request("/auth/signin");
      const location = new URL(signIn.headers.get("location")!);
      expect(location.searchParams.get("redirect_uri")).toBe(
        "https://herald.zenod.dev/auth/github/callback",
      );
    } finally {
      callbackUnit.close();
    }
  });
});
