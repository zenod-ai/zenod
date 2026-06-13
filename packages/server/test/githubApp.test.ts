import { generateKeyPairSync, createVerify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appJwt, appStatus, buildManifest, disconnectApp, installationToken } from "../src/githubApp.js";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

describe("GitHub App flow", () => {
  let dir: string;
  let runtime: Runtime;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-ghapp-"));
    runtime = new Runtime(dir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("builds a manifest with the instance callbacks", () => {
    const { action, manifest } = buildManifest("https://app.zenod.dev");
    expect(action).toBe("https://github.com/settings/apps/new");
    expect(manifest.redirect_url).toBe("https://app.zenod.dev/api/github/app/callback");
    expect(manifest.setup_url).toBe("https://app.zenod.dev/api/github/app/setup");
    expect(manifest.default_permissions).toEqual({ contents: "write", issues: "write", metadata: "read" });
    expect(String(manifest.name)).toMatch(/^zenod-[0-9a-f]{4}$/);
  });

  it("signs a verifiable RS256 app JWT", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
    const jwt = appJwt("12345", pem, 1_750_000_000);

    const [header, payload, signature] = jwt.split(".");
    const decode = (part: string) => JSON.parse(Buffer.from(part!, "base64url").toString());
    expect(decode(header!)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(payload!)).toEqual({ iat: 1_750_000_000 - 60, exp: 1_750_000_000 + 540, iss: "12345" });

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
  });

  it("mints and caches installation tokens", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const settings = runtime.settings;
    settings.setRaw("github_app_id", "99");
    settings.setRaw("github_app_private_key", privateKey.export({ type: "pkcs1", format: "pem" }) as string);
    settings.setRaw("github_app_installation_id", "777");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ token: "ghs_minted", expires_at: new Date(Date.now() + 3600_000).toISOString() }),
        { status: 201 },
      ),
    );

    expect(await installationToken(settings)).toBe("ghs_minted");
    expect(await installationToken(settings)).toBe("ghs_minted"); // cached
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/app/installations/777/access_tokens");

    disconnectApp(settings); // also clears the token cache
    expect(settings.hasGithubApp()).toBe(false);
  });

  it("reports app status and counts a connected app as configured", async () => {
    const settings = runtime.settings;
    expect(appStatus(settings)).toEqual({ created: false, installed: false, slug: null, installationId: null });

    settings.setRaw("github_app_id", "99");
    settings.setRaw("github_app_private_key", "pem");
    settings.setRaw("github_app_slug", "zenod-abcd");
    settings.setRaw("github_app_installation_id", "777");
    expect(appStatus(settings)).toEqual({ created: true, installed: true, slug: "zenod-abcd", installationId: "777" });

    settings.set("vault_repo", "owner/vault");
    settings.set("anthropic_api_key", "sk-ant-x");
    expect(settings.configured()).toBe(true); // no PAT needed
  });

  it("selects the active provider's key for configured()", () => {
    const settings = runtime.settings;
    settings.set("vault_repo", "owner/vault");
    settings.set("github_token", "ghp_x");
    expect(settings.provider()).toBe("anthropic"); // default
    expect(settings.configured()).toBe(false);

    settings.set("openai_api_key", "sk-openai");
    expect(settings.configured()).toBe(false); // openai key set but provider is anthropic

    settings.set("provider", "openai");
    expect(settings.provider()).toBe("openai");
    expect(settings.activeApiKey()).toBe("sk-openai");
    expect(settings.configured()).toBe(true);

    settings.set("provider", "anthropic");
    expect(settings.configured()).toBe(false); // back to anthropic, no anthropic key
    settings.set("anthropic_api_key", "sk-ant");
    expect(settings.configured()).toBe(true);
  });

  it("masks both provider keys independently", () => {
    const settings = runtime.settings;
    settings.set("anthropic_api_key", "sk-ant-secret1234");
    settings.set("openai_api_key", "sk-openai-secret5678");
    const masked = settings.masked();
    expect(masked.anthropic_api_key).toBe("••••1234");
    expect(masked.openai_api_key).toBe("••••5678");
    expect(masked.provider).toBe("anthropic");
  });

  it("vault is configured with repo + app even before the Anthropic key", () => {
    const settings = runtime.settings;
    settings.set("vault_repo", "owner/vault");
    settings.setRaw("github_app_id", "99");
    settings.setRaw("github_app_private_key", "pem");
    settings.setRaw("github_app_installation_id", "777");

    expect(settings.vaultConfigured()).toBe(true);
    expect(settings.configured()).toBe(false); // engine still needs the LLM key

    settings.set("anthropic_api_key", "sk-ant-x");
    expect(settings.configured()).toBe(true);
  });

  it("setup endpoint stores the installation id and redirects to the UI", async () => {
    const app = createApp(runtime);
    const token = runtime.settings.apiToken();
    const res = await app.request("/api/github/app/setup?installation_id=4242&setup_action=install", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?github=connected");
    expect(runtime.settings.getRaw("github_app_installation_id")).toBe("4242");
  });

  it("start endpoint derives the base URL from forwarded headers", async () => {
    const app = createApp(runtime);
    const res = await app.request("/api/github/app/start", {
      headers: {
        Authorization: `Bearer ${runtime.settings.apiToken()}`,
        "x-forwarded-proto": "https",
        "x-forwarded-host": "app.zenod.dev",
      },
    });
    const body = await res.json();
    expect(body.manifest.redirect_url).toBe("https://app.zenod.dev/api/github/app/callback");
  });
});
