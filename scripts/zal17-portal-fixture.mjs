#!/usr/bin/env node

import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.ZAL17_FIXTURE_PORT ?? 4174);
const distDir = join(import.meta.dirname, "..", "apps", "web", "dist");

if (!existsSync(join(distDir, "index.html"))) {
  throw new Error(
    "Build the web workspace before starting the ZAL-17 portal fixture.",
  );
}

const json = (response, body, status = 200) => {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
};

const settings = {
  vault_repo: "example/memory",
  vault_branch: "main",
  github_token: null,
  provider: "openrouter",
  anthropic_api_key: null,
  openai_api_key: null,
  openrouter_api_key: null,
  model_ask: "example/model",
  model_classify: "example/model",
  model_vision: "example/model",
  model_max_steps: "8",
  google_service_account_json: null,
  google_oauth_client_id: null,
  google_oauth_client_secret: null,
  google_drive_folder_id: null,
  groq_api_key: null,
  openai_long_transcription: null,
  long_transcription_provider: "openrouter",
  openrouter_transcription_model: null,
  composio_api_key: null,
  composio_user_id: null,
};

const usageSummary = {
  since: 0,
  calls: 3,
  inputTokens: 1200,
  outputTokens: 180,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  costUsd: 0.01,
  byOperation: [
    {
      key: "answer",
      calls: 3,
      inputTokens: 1200,
      outputTokens: 180,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0.01,
    },
  ],
  byModel: [
    {
      key: "example/model",
      calls: 3,
      inputTokens: 1200,
      outputTokens: 180,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0.01,
    },
  ],
};

function edition(request) {
  return request.headers.cookie?.includes("zal17_edition=self-hosted")
    ? "self-hosted"
    : "hosted";
}

function apiResponse(request, response, pathname) {
  const currentEdition = edition(request);
  const hosted = currentEdition === "hosted";

  if (pathname === "/api/auth/status") {
    return json(response, {
      needsSetup: false,
      configured: true,
      hostedMode: hosted ? "managed" : null,
      customerAuth: hosted,
      authMethod: hosted ? "github" : "admin",
    });
  }
  if (pathname === "/api/me") return json(response, { login: "beta-tester" });
  if (pathname === "/api/settings")
    return json(response, { settings, configured: true });
  if (pathname === "/api/overview") {
    return json(response, {
      tenant: { id: "zal17-fixture", name: "Beta acceptance" },
      unit: { name: "zenod", version: "candidate" },
      usage: hosted ? null : { units: 3 },
    });
  }
  if (pathname === "/api/console/account") {
    return json(response, {
      mcp_url: "http://127.0.0.1/mcp",
      token: "fixture-token",
      usage: hosted
        ? {
            percentageUsed: 16,
            state: "normal",
            resetsAt: "2026-09-01T00:00:00.000Z",
          }
        : null,
    });
  }
  if (pathname === "/api/connections") {
    return json(response, {
      token: "fixture-token",
      mcpPath: "/mcp",
      clients: [],
      grants: [],
    });
  }
  if (pathname === "/api/customer-usage") {
    return json(response, {
      percentageUsed: 16,
      state: "normal",
      resetsAt: "2026-09-01T00:00:00.000Z",
    });
  }
  if (pathname === "/api/channels") {
    return json(response, {
      whatsapp: {
        state: "verified",
        senderHint: "+34 *** ** 42",
        sharedNumber: "+34 *** ** 00",
        verificationExpiresAt: null,
        lastInboundAt: Date.now() - 60_000,
        lastReceiptAt: Date.now() - 30_000,
        revision: "wa-fixture-1",
      },
      telegram: {
        state: "connected",
        identityHint: "User 63050995",
        verificationExpiresAt: null,
        revision: "tg-fixture-1",
      },
    });
  }
  if (pathname === "/api/telegram/status") {
    return json(response, {
      enabled: true,
      state: "connected",
      botUsername: "zenod_fixture_bot",
      hasToken: true,
      lastActivity: Date.now() - 60_000,
      lastError: null,
      allowedUsers: ["63050995"],
      acceptAll: false,
      rich: true,
    });
  }
  if (pathname === "/api/vault") {
    return json(response, {
      repo: "example/memory",
      branch: "main",
      vaultConfigured: true,
      configured: true,
      provider: "openrouter",
      llmReady: true,
      cloned: true,
      headSha: "a412dd0a369931f38b707a907264ed828908604b",
      cloneError: null,
    });
  }
  if (pathname === "/api/drive/status") {
    return json(response, {
      configured: false,
      archiveConfigured: false,
      archiveReason: null,
      authMode: null,
      clientEmail: null,
      oauthEmail: null,
      oauthClientConfigured: false,
      oauthClientId: null,
      folderId: null,
      transcriptionProvider: hosted ? null : "openrouter",
    });
  }
  if (pathname === "/api/transcription/status") {
    return json(response, {
      model: "fixture",
      ready: true,
      downloading: false,
      progress: 100,
      error: null,
    });
  }
  if (pathname === "/api/usage") {
    return hosted
      ? json(response, { error: "Not available for Hosted customers" }, 403)
      : json(response, { today: usageSummary, last7d: usageSummary });
  }
  if (pathname === "/api/github/app/status") {
    return json(response, {
      configured: true,
      connected: true,
      installationId: 1,
      repo: "example/memory",
    });
  }
  return json(
    response,
    { error: `Fixture route not implemented: ${pathname}` },
    404,
  );
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    return apiResponse(request, response, url.pathname);
  }

  if (url.pathname === "/hosted" || url.pathname === "/self-hosted") {
    response.setHeader(
      "set-cookie",
      `zal17_edition=${url.pathname.slice(1)}; Path=/; SameSite=Strict`,
    );
  }

  const requested = url.pathname.startsWith("/assets/")
    ? normalize(url.pathname.slice(1))
    : "index.html";
  const file = join(distDir, requested);
  if (!file.startsWith(distDir)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const metadata = await stat(file);
    if (!metadata.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ZAL-17 portal fixture: http://127.0.0.1:${port}/hosted`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
