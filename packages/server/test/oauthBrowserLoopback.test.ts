import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { serve } from "@hono/node-server";
import { afterEach, expect, it } from "vitest";
import { createZenodUnit } from "../src/zenodUnit.js";

const CHASSIS_VAULT_MASTER_KEY = "33".repeat(32);
const tempDirs: string[] = [];

function chromeExecutable(): string | null {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condition did not become ready within ${timeoutMs}ms`);
}

async function connectDevtools(url: string): Promise<{
  close(): void;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Chrome DevTools socket failed")), {
      once: true,
    });
  });
  let nextId = 0;
  const pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message ?? "Chrome DevTools error"));
    else request.resolve(message.result);
  });
  return {
    close: () => socket.close(),
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => process.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (process.exitCode === null && process.signalCode === null) process.kill("SIGKILL");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const chrome = chromeExecutable();
const browserTest = chrome ? it : it.skip;

browserTest(
  "completes the native MCP OAuth loopback in a real browser under production headers",
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zenod-zpf3-browser-"));
    tempDirs.push(dataDir);
    const directToken = "zenod_browser_loopback_direct_token";
    const unit = createZenodUnit({
      dataDir,
      env: {
        NODE_ENV: "production",
        ZENOD_API_TOKEN: directToken,
        ZENOD_TENANT_ID: "browser-loopback-tenant",
        CHASSIS_VAULT_MASTER_KEY,
      },
    });
    const zenodServer = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const started = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(started));
    });
    const zenodAddress = zenodServer.address() as AddressInfo;
    const origin = `http://127.0.0.1:${zenodAddress.port}`;

    let resolveCallback!: (url: URL) => void;
    let rejectCallback!: (error: Error) => void;
    const callbackReceived = new Promise<URL>((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });
    const callbackServer = createServer((request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>Connected</title>Zenod connected");
        resolveCallback(url);
      } catch (error) {
        rejectCallback(error instanceof Error ? error : new Error(String(error)));
      }
    });
    await new Promise<void>((resolve) => callbackServer.listen(0, "127.0.0.1", resolve));
    const callbackAddress = callbackServer.address() as AddressInfo;
    const redirectUri = `http://127.0.0.1:${callbackAddress.port}/callback`;

    let chromeProcess: ChildProcess | null = null;
    let devtools: Awaited<ReturnType<typeof connectDevtools>> | null = null;
    try {
      const verifier = "zpf3-real-browser-loopback-verifier";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const registration = await fetch(`${origin}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "ZPF-3 real browser",
          redirect_uris: [redirectUri],
        }),
      });
      expect(registration.status).toBe(201);
      const { client_id: clientId } = await registration.json() as { client_id: string };
      const authorize = new URL(`${origin}/oauth/authorize`);
      authorize.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        state: "zpf3-browser-state",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: `${origin}/mcp`,
        scope: "mcp",
      }).toString();

      const browserDir = await mkdtemp(join(tmpdir(), "zenod-zpf3-chrome-"));
      tempDirs.push(browserDir);
      chromeProcess = spawn(chrome!, [
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--remote-debugging-port=0",
        `--user-data-dir=${browserDir}`,
        "about:blank",
      ], { stdio: "ignore" });
      const debuggingPort = await waitFor(async () => {
        try {
          const [port] = (await readFile(join(browserDir, "DevToolsActivePort"), "utf8")).trim().split("\n");
          return port ? Number(port) : null;
        } catch {
          return null;
        }
      }, 30_000);
      const target = await fetch(
        `http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(authorize.toString())}`,
        { method: "PUT" },
      ).then((response) => response.json()) as { webSocketDebuggerUrl: string };
      devtools = await connectDevtools(target.webSocketDebuggerUrl);
      await devtools.send("Runtime.enable");
      await waitFor(async () => {
        const result = await devtools!.send("Runtime.evaluate", {
          expression: "document.readyState === 'complete' && Boolean(document.querySelector('button.approve'))",
          returnByValue: true,
        }) as { result?: { value?: boolean } };
        return result.result?.value ? true : null;
      });
      await devtools.send("Runtime.evaluate", {
        expression: `(() => {
          const input = document.getElementById("token");
          if (!(input instanceof HTMLInputElement)) throw new Error("tenant token input missing");
          input.value = ${JSON.stringify(directToken)};
          const button = document.querySelector("button.approve");
          if (!(button instanceof HTMLButtonElement)) throw new Error("Connect button missing");
          button.click();
          return true;
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });

      const callback = await Promise.race([
        callbackReceived,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("browser did not reach the OAuth loopback callback")), 10_000),
        ),
      ]);
      expect(callback.pathname).toBe("/callback");
      expect(callback.searchParams.get("state")).toBe("zpf3-browser-state");
      const code = callback.searchParams.get("code");
      expect(code).toBeTruthy();

      const tokenResponse = await fetch(`${origin}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code!,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }),
      });
      expect(tokenResponse.status).toBe(200);
      const { access_token: oauthToken } = await tokenResponse.json() as { access_token: string };
      const initialize = (token: string) => fetch(`${origin}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "zpf3-browser-auth",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "zpf3-browser", version: "1" },
          },
        }),
      });
      expect((await initialize(directToken)).status).toBe(200);
      expect((await initialize(oauthToken)).status).toBe(200);
    } finally {
      devtools?.close();
      if (chromeProcess) await stopProcess(chromeProcess);
      await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
      await new Promise<void>((resolve) => zenodServer.close(() => resolve()));
      await unit.close();
    }
  },
  60_000,
);
