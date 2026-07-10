import { generateKeyPairSync, createVerify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appJwt, appStatus, createGithubIssue, disconnectApp, editGithubIssue, githubAppInstallationUrl, installationToken } from "zenod";
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

  it("builds only the existing app installation URL for customer repository access", () => {
    runtime.settings.setRaw("github_app_slug", "zenod-memory-v01a");
    expect(githubAppInstallationUrl(runtime.settings)).toBe(
      "https://github.com/apps/zenod-memory-v01a/installations/new",
    );
  });

  it("falls back to the configured PAT when a repo-scoped app token gets a 403", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const settings = runtime.settings;
    settings.setRaw("github_app_id", "fallback-app");
    settings.setRaw("github_app_private_key", privateKey.export({ type: "pkcs1", format: "pem" }) as string);
    settings.setRaw("github_app_installation_id", "fallback-installation");
    settings.set("github_token", "ghp_fallback");

    const issueCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = String(url).replace("https://api.github.com", "");
      const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      if (path === "/repos/zenod-ai/fallback-fixture/installation") {
        return new Response(JSON.stringify({ id: 888 }), { status: 200 });
      }
      if (path === "/app/installations/888/access_tokens") {
        return new Response(
          JSON.stringify({ token: "ghs_repo_scoped_without_issue_write", expires_at: new Date(Date.now() + 3600_000).toISOString() }),
          { status: 201 },
        );
      }
      if (path === "/repos/zenod-ai/fallback-fixture/issues/52") {
        issueCalls.push(auth);
        if (auth === "Bearer ghs_repo_scoped_without_issue_write") {
          return new Response("Resource not accessible by integration", { status: 403 });
        }
        if (auth === "Bearer ghp_fallback") {
          return new Response(
            JSON.stringify({
              html_url: "https://github.com/zenod-ai/fallback-fixture/issues/52",
              labels: [{ name: "status:proposed" }],
            }),
            { status: 200 },
          );
        }
      }
      return new Response(`unexpected ${init?.method ?? "GET"} ${path}`, { status: 500 });
    });

    const result = await editGithubIssue(settings, { repo: "zenod-ai/fallback-fixture", issueNumber: 52 });

    expect(result.issueUrl).toBe("https://github.com/zenod-ai/fallback-fixture/issues/52");
    expect(issueCalls).toEqual(["Bearer ghs_repo_scoped_without_issue_write", "Bearer ghp_fallback"]);
  });

  it("refuses repo mutations through an app that is not installed on the target repo unless a PAT exists", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const settings = runtime.settings;
    settings.setRaw("github_app_id", "public-create-trap-app");
    settings.setRaw("github_app_private_key", privateKey.export({ type: "pkcs1", format: "pem" }) as string);
    settings.setRaw("github_app_installation_id", "stored-installation");

    const calls: Array<{ path: string; method: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = String(url).replace("https://api.github.com", "");
      calls.push({ path, method: init?.method ?? "GET" });
      if (path === "/repos/zenod-ai/uninstalled-public/installation") {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      return new Response(`unexpected ${init?.method ?? "GET"} ${path}`, { status: 500 });
    });

    await expect(
      createGithubIssue(settings, {
        repo: "zenod-ai/uninstalled-public",
        title: "Should not be publicly created",
      }),
    ).rejects.toThrow(/GitHub App is not installed on zenod-ai\/uninstalled-public|Configure a GitHub token/);

    expect(calls).toEqual([{ path: "/repos/zenod-ai/uninstalled-public/installation", method: "GET" }]);
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

  it("start endpoint returns the existing app installation URL and never a manifest", async () => {
    const app = createApp(runtime);
    runtime.settings.setRaw("github_app_slug", "zenod-memory-v01a");
    const res = await app.request("/api/github/app/start", {
      headers: {
        Authorization: `Bearer ${runtime.settings.apiToken()}`,
        "x-forwarded-proto": "https",
        "x-forwarded-host": "c1.zenod.dev",
      },
    });
    const body = await res.json();
    expect(body).toEqual({ url: "https://github.com/apps/zenod-memory-v01a/installations/new" });
    expect(JSON.stringify(body)).not.toContain("manifest");
  });

  it("edits issue fields, labels, status, assignees, and comments through GitHub", async () => {
    const settings = runtime.settings;
    settings.set("vault_repo", "zenod-ai/fixture");
    settings.set("github_token", "ghp_test");

    let postedComment = false;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = String(url).replace("https://api.github.com", "");
      if (path === "/repos/zenod-ai/fixture/issues/52" && !init?.method) {
        return new Response(
          JSON.stringify({
            html_url: "https://github.com/zenod-ai/fixture/issues/52",
            labels: [{ name: "status:proposed" }, { name: "owner:human" }],
          }),
          { status: 200 },
        );
      }
      if (path === "/repos/zenod-ai/fixture/issues/52" && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            html_url: "https://github.com/zenod-ai/fixture/issues/52",
            labels: [{ name: "status:proposed" }, { name: "owner:human" }],
          }),
          { status: 200 },
        );
      }
      if (path === "/repos/zenod-ai/fixture/issues/52/labels/owner%3Ahuman" && init?.method === "DELETE") {
        return new Response(JSON.stringify([{ name: "status:proposed" }]), { status: 200 });
      }
      if (path === "/repos/zenod-ai/fixture/issues/52/labels" && init?.method === "POST") {
        return new Response(
          JSON.stringify([
            { name: "status:proposed" },
            { name: "owner:agent" },
          ]),
          { status: 200 },
        );
      }
      if (path === "/repos/zenod-ai/fixture/issues/52/labels" && init?.method === "PUT") {
        return new Response(
          JSON.stringify([
            { name: "owner:agent" },
            { name: "status:blocked" },
          ]),
          { status: 200 },
        );
      }
      if (path === "/repos/zenod-ai/fixture/issues/52/comments?per_page=100" && !init?.method) {
        // Read-back honesty: after the POST, the new comment is visible.
        const body = postedComment
          ? [{ body: "Older comment." }, { body: "Blocked on a product decision." }]
          : [{ body: "Older comment." }];
        return new Response(JSON.stringify(body), { status: 200 });
      }
      if (path === "/repos/zenod-ai/fixture/issues/52/comments" && init?.method === "POST") {
        postedComment = true;
        return new Response(JSON.stringify({ html_url: "https://github.com/zenod-ai/fixture/issues/52#comment" }), { status: 201 });
      }
      return new Response(`unexpected ${init?.method ?? "GET"} ${path}`, { status: 500 });
    });

    const result = await editGithubIssue(settings, {
      issueNumber: 52,
      title: "Clarify launch scope",
      body: "Updated body",
      assignees: ["octo"],
      labelsRemove: ["owner:human"],
      labelsAdd: ["owner:agent"],
      status: "blocked",
      comment: "Blocked on a product decision.",
    });

    expect(result).toMatchObject({
      repo: "zenod-ai/fixture",
      issueNumber: 52,
      issueUrl: "https://github.com/zenod-ai/fixture/issues/52",
      labels: ["owner:agent", "status:blocked"],
    });
    expect(result.operations).toEqual([
      "updated title",
      "updated body",
      "replaced assignees",
      "removed labels",
      "added labels",
      "set status:blocked",
      "posted comment",
    ]);

    const patch = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/issues/52") && call[1]?.method === "PATCH")!;
    expect(JSON.parse(String(patch[1]!.body))).toEqual({
      title: "Clarify launch scope",
      body: "Updated body",
      assignees: ["octo"],
    });
    const addLabels = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/issues/52/labels") && call[1]?.method === "POST")!;
    expect(JSON.parse(String(addLabels[1]!.body))).toEqual({ labels: ["owner:agent"] });
    const setStatus = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/issues/52/labels") && call[1]?.method === "PUT").at(-1)!;
    expect(JSON.parse(String(setStatus[1]!.body))).toEqual({ labels: ["owner:agent", "status:blocked"] });
  });

  it("does not post an exact duplicate issue comment", async () => {
    const settings = runtime.settings;
    settings.set("vault_repo", "zenod-ai/fixture");
    settings.set("github_token", "ghp_test");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = String(url).replace("https://api.github.com", "");
      if (path === "/repos/zenod-ai/fixture/issues/52" && !init?.method) {
        return new Response(
          JSON.stringify({
            html_url: "https://github.com/zenod-ai/fixture/issues/52",
            labels: [{ name: "status:proposed" }],
          }),
          { status: 200 },
        );
      }
      if (path === "/repos/zenod-ai/fixture/issues/52/comments?per_page=100" && !init?.method) {
        return new Response(JSON.stringify([{ body: "Already posted." }]), { status: 200 });
      }
      if (path === "/repos/zenod-ai/fixture/issues/52/comments" && init?.method === "POST") {
        return new Response("duplicate post should not happen", { status: 500 });
      }
      return new Response(`unexpected ${init?.method ?? "GET"} ${path}`, { status: 500 });
    });

    const result = await editGithubIssue(settings, {
      issueNumber: 52,
      comment: "Already posted.",
    });

    expect(result.operations).toEqual(["comment already present"]);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/issues/52/comments") && call[1]?.method === "POST")).toBe(false);
  });

  it("ignores empty labelsSet when closing so labels are not wiped", async () => {
    const settings = runtime.settings;
    settings.set("vault_repo", "zenod-ai/fixture");
    settings.set("github_token", "ghp_test");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = String(url).replace("https://api.github.com", "");
      if (path === "/repos/zenod-ai/fixture/issues/52" && !init?.method) {
        return new Response(
          JSON.stringify({
            html_url: "https://github.com/zenod-ai/fixture/issues/52",
            labels: [{ name: "status:proposed" }, { name: "v5" }],
          }),
          { status: 200 },
        );
      }
      if (path === "/repos/zenod-ai/fixture/issues/52" && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            html_url: "https://github.com/zenod-ai/fixture/issues/52",
            labels: [{ name: "status:proposed" }, { name: "v5" }],
          }),
          { status: 200 },
        );
      }
      return new Response(`unexpected ${init?.method ?? "GET"} ${path}`, { status: 500 });
    });

    const result = await editGithubIssue(settings, { issueNumber: 52, state: "closed", labelsSet: [] });

    expect(result.labels).toEqual(["status:proposed", "v5"]);
    expect(result.operations).toEqual(["closed"]);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/issues/52/labels"))).toBe(false);
  });

  it("requires explicit queue approval before setting status:queued", async () => {
    const settings = runtime.settings;
    settings.set("vault_repo", "zenod-ai/fixture");
    settings.set("github_token", "ghp_test");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.method === "PUT") {
        return new Response(JSON.stringify([{ name: "owner:agent" }, { name: "status:queued" }]), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          html_url: "https://github.com/zenod-ai/fixture/issues/53",
          labels: [{ name: "status:proposed" }, { name: "owner:agent" }],
        }),
        { status: 200 },
      );
    });

    await expect(editGithubIssue(settings, { issueNumber: 53, status: "queued" })).rejects.toThrow(/requires explicit user approval/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await editGithubIssue(settings, { issueNumber: 53, status: "queued", queueApproval: true });
    const put = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ labels: ["owner:agent", "status:queued"] });
  });

  it("normalizes gated labels in generic label edits", async () => {
    const settings = runtime.settings;
    settings.set("vault_repo", "zenod-ai/fixture");
    settings.set("github_token", "ghp_test");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = String(url).replace("https://api.github.com", "");
      if (path === "/repos/zenod-ai/fixture/issues/54" && !init?.method) {
        return new Response(JSON.stringify({ html_url: "https://github.com/zenod-ai/fixture/issues/54", labels: [] }), { status: 200 });
      }
      if (path === "/repos/zenod-ai/fixture/issues/54/labels" && init?.method === "POST") {
        return new Response(JSON.stringify([{ name: "status:proposed" }, { name: "owner:agent" }]), { status: 200 });
      }
      return new Response(`unexpected ${init?.method ?? "GET"} ${path}`, { status: 500 });
    });

    const result = await editGithubIssue(settings, { issueNumber: 54, labelsAdd: ["owner:agent", "status:queued"] });

    expect(result.labels).toEqual(["status:proposed", "owner:agent"]);
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ labels: ["owner:agent", "status:proposed"] });
  });
});
