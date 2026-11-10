/**
 * EPIC-24 M6: Traefik keeps idle connections to Zenod open for 90 s (its default idle timeout) and
 * reuses them, while Node closes an idle keep-alive connection after 5 s. When the two cross (more
 * often while a filing holds the event loop), Traefik sends a request on a socket Node is closing; a
 * GET is retried but a POST (every MCP call) comes back 502. Node must outlast the proxy, so the
 * proxy is always the side that closes an idle connection.
 */
export const PROXY_KEEP_ALIVE_MS = 95_000;

export interface KeepAliveServer {
  keepAliveTimeout?: number;
  headersTimeout?: number;
}

export function outlastProxyKeepAlive(server: unknown): void {
  const http = server as KeepAliveServer;
  if (typeof http.keepAliveTimeout !== "number") return;
  http.keepAliveTimeout = PROXY_KEEP_ALIVE_MS;
  // headersTimeout must exceed keepAliveTimeout, or Node drops a slow first request on a reused socket.
  http.headersTimeout = PROXY_KEEP_ALIVE_MS + 1_000;
}
