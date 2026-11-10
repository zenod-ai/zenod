import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { outlastProxyKeepAlive, PROXY_KEEP_ALIVE_MS } from "../src/proxyKeepAlive.js";

// Traefik's default idle connection timeout to a backend.
const TRAEFIK_IDLE_CONN_TIMEOUT_MS = 90_000;

describe("outlastProxyKeepAlive", () => {
  it("keeps idle connections open longer than the proxy does, headers timeout above it", () => {
    const server = createServer();
    expect(server.keepAliveTimeout).toBeLessThan(TRAEFIK_IDLE_CONN_TIMEOUT_MS);
    outlastProxyKeepAlive(server);
    expect(server.keepAliveTimeout).toBe(PROXY_KEEP_ALIVE_MS);
    expect(server.keepAliveTimeout).toBeGreaterThan(TRAEFIK_IDLE_CONN_TIMEOUT_MS);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });

  it("leaves a server without keep-alive settings alone", () => {
    const server = {};
    outlastProxyKeepAlive(server);
    expect(server).toEqual({});
  });
});
