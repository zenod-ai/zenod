import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

/**
 * Headless provisioning (Jordi's token-origination model): the agent boots
 * un-provisioned and idles; the Console MINTS the token and pushes it (plus
 * config) to /api/provision; the agent instantiates itself with the given token
 * and goes live. The Console never retrieves a token — it originated it.
 */
describe("headless provisioning", () => {
  let dir: string;
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-provision-"));
    process.env.ZENOD_AWAIT_PROVISION = "1";
    runtime = new Runtime(dir); // un-provisioned: must NOT mint its own token
    app = createApp(runtime);
  });

  afterEach(async () => {
    delete process.env.ZENOD_AWAIT_PROVISION;
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("boots un-provisioned: mints no token of its own and idles", async () => {
    expect(runtime.settings.getRaw("api_token")).toBeNull();
    expect(runtime.settings.awaitingProvision()).toBe(true);
    // auth-gated endpoints are unreachable (there is no token yet)
    expect((await app.request("/api/settings")).status).toBe(401);
  });

  it("the Console mints+pushes a token; the agent instantiates itself and goes live", async () => {
    const res = await app.request("/api/provision", {
      method: "POST",
      body: JSON.stringify({
        token: "console-minted-token-123",
        provider: "anthropic",
        api_key: "sk-ant-xyz",
        vault_repo: "owner/z2-vault",
        github_token: "ghp_fromconsole",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(true);

    // it adopted the CONSOLE-minted token — that token now authenticates to it
    expect(runtime.settings.apiToken()).toBe("console-minted-token-123");
    expect(
      (await app.request("/api/settings", { headers: { Authorization: "Bearer console-minted-token-123" } })).status,
    ).toBe(200);
    // and it took the pushed config
    expect(runtime.settings.get("vault_repo")).toBe("owner/z2-vault");
    expect(runtime.settings.activeApiKey()).toBe("sk-ant-xyz");
  });

  it("is one-shot: a second provision is refused and the endpoint falls back under auth", async () => {
    await app.request("/api/provision", { method: "POST", body: JSON.stringify({ token: "t1" }) });
    expect(runtime.settings.awaitingProvision()).toBe(false);
    // Once provisioned, the endpoint is no longer open: an unauthenticated retry is
    // refused under auth (401); an authenticated one would hit the handler's 403.
    const second = await app.request("/api/provision", { method: "POST", body: JSON.stringify({ token: "t2" }) });
    expect([401, 403]).toContain(second.status);
    // the minted token was not overwritten
    expect(runtime.settings.apiToken()).toBe("t1");
  });

  it("requires a token", async () => {
    const res = await app.request("/api/provision", {
      method: "POST",
      body: JSON.stringify({ provider: "anthropic" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts GitHub credential sync after one-shot provisioning", async () => {
    await app.request("/api/provision", { method: "POST", body: JSON.stringify({ token: "t1" }) });

    const res = await app.request("/api/agent/github", {
      method: "POST",
      headers: { Authorization: "Bearer t1" },
      body: JSON.stringify({
        github_token: "ghp_synced",
        github_app_id: "99",
        github_app_private_key: "pem",
        github_app_installation_id: "777",
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, hasGithubToken: true, hasGithubApp: true });
    expect(runtime.settings.get("github_token")).toBe("ghp_synced");
    expect(runtime.settings.getRaw("github_app_installation_id")).toBe("777");
  });

  it("adopts Composio credentials pushed at provision time and masks the key (#420)", async () => {
    await app.request("/api/provision", {
      method: "POST",
      body: JSON.stringify({ token: "t1", composio_api_key: "ak_secret123", composio_user_id: "jordimr" }),
    });
    expect(runtime.settings.get("composio_api_key")).toBe("ak_secret123");
    expect(runtime.settings.get("composio_user_id")).toBe("jordimr");
    // The key is a secret (masked for the UI); the user id is plain.
    const masked = runtime.settings.masked();
    expect(masked.composio_user_id).toBe("jordimr");
    expect(masked.composio_api_key).not.toBe("ak_secret123");
    expect(masked.composio_api_key).toContain("•");
  });
});
