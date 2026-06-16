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
});
