import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic, type ServeStaticOptions } from "@hono/node-server/serve-static";
import type { Context, Hono, MiddlewareHandler } from "hono";

export interface StaticSurfaceOptions {
  webDist?: string;
  siteDist?: string;
  publicSiteHost?: string;
}

type ServerEnv = { Bindings: HttpBindings };

function requestHost(value: string | undefined): string {
  return (value ?? "").split(",")[0]!.trim().split(":")[0]!.toLowerCase();
}

export function isPublicSiteHost(value: string | undefined, configuredHost?: string): boolean {
  const host = requestHost(value);
  const configured = (configuredHost ?? process.env.ZENOD_PUBLIC_SITE_HOST ?? "zenod.dev").toLowerCase();
  return host === configured || host === "localhost" || host === "127.0.0.1" || host === "::1";
}

// ZAL-A19: the console's client routes. Its tabs live in `#hash` and `?tab=`, so
// only these paths serve the app shell; any other unknown path is a real 404.
export function isWebAppPath(path: string): boolean {
  return path === "/" || path === "/index.html" || path === "/account" || path === "/admin" ||
    path === "/app" || path.startsWith("/app/");
}

const API_PATH = /^\/(?:api|auth|oauth|mcp|internal|\.well-known)(?:\/|$)/;

// ZAL-A19: the 404 for unknown paths, on zenod.dev and cloud.zenod.dev alike:
// the site's own not-found page (apps/site/404.html), JSON for API-like paths.
export function siteNotFound(siteDist: string | undefined): (c: Context) => Response {
  let page: string | null | undefined;
  return (c) => {
    if (API_PATH.test(c.req.path)) return c.json({ error: "not found" }, 404);
    if (page === undefined) {
      try {
        page = siteDist ? readFileSync(join(siteDist, "404.html"), "utf8") : null;
      } catch {
        page = null;
      }
    }
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    return page ? c.html(page, 404) : c.text("Not found", 404);
  };
}

// ZAL-A20: http -> https behind Cloudflare. The tunnel lands every request on
// Traefik over one scheme, so the visitor's own scheme only survives in
// Cloudflare's Cf-Visitor header. Without that header (local, self-host) nothing changes.
export function cloudflareHttpsRedirect(): MiddlewareHandler {
  return async (c, next) => {
    let scheme: unknown;
    try {
      scheme = (JSON.parse(c.req.header("cf-visitor") ?? "{}") as { scheme?: unknown }).scheme;
    } catch {
      scheme = undefined;
    }
    if (scheme !== "http") return next();
    const url = new URL(c.req.url);
    const host = requestHost(c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.hostname);
    if (!host) return next();
    const method = c.req.method;
    return c.redirect(`https://${host}${url.pathname}${url.search}`, method === "GET" || method === "HEAD" ? 301 : 308);
  };
}

export function mountStaticSurfaces(app: Hono<ServerEnv>, options: StaticSurfaceOptions): void {
  const noCache: Pick<ServeStaticOptions<ServerEnv>, "onFound"> = {
    onFound: (_path, c) => c.header("Cache-Control", "no-cache, no-store, must-revalidate"),
  };
  const staticFile = (staticOptions: ServeStaticOptions<ServerEnv>) => serveStatic<ServerEnv>(staticOptions);

  if (!options.siteDist) {
    if (options.webDist) {
      // Protocol/auth requests must reach their handlers, including the MCP 401
      // discovery challenge, rather than receive a successful SPA HTML response.
      const webOnly = (handler: MiddlewareHandler<ServerEnv>): MiddlewareHandler<ServerEnv> =>
        (c, next) => /^\/(?:api|auth|oauth|mcp|internal|\.well-known)(?:\/|$)/.test(c.req.path)
          ? next()
          : handler(c, next);
      app.use("/*", webOnly(staticFile({ root: options.webDist, ...noCache })));
      app.get("*", webOnly(staticFile({ root: options.webDist, path: "index.html", ...noCache })));
    }
    return;
  }

  if (options.webDist) {
    const webRoot = options.webDist;
    app.use("/assets/*", staticFile({ root: webRoot, ...noCache }));
    app.use(
      "/app/*",
      staticFile({
        root: webRoot,
        rewriteRequestPath: (path) => path.replace(/^\/app/, "") || "/",
        ...noCache,
      }),
    );
    app.get("/app", staticFile({ root: webRoot, path: "index.html", ...noCache }));
    app.get("/app/*", staticFile({ root: webRoot, path: "index.html", ...noCache }));
  }

  const siteRoot = options.siteDist;
  app.use(
    "/site/*",
    staticFile({
      root: siteRoot,
      rewriteRequestPath: (path) => path.replace(/^\/site/, "") || "/",
      ...noCache,
    }),
  );

  const publicHostOnly =
    (handler: MiddlewareHandler<ServerEnv>): MiddlewareHandler<ServerEnv> =>
    async (c, next) => {
      const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).hostname;
      return isPublicSiteHost(host, options.publicSiteHost) ? handler(c, next) : next();
    };
  const nonPublicHostOnly =
    (handler: MiddlewareHandler<ServerEnv>): MiddlewareHandler<ServerEnv> =>
    async (c, next) => {
      const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).hostname;
      return isPublicSiteHost(host, options.publicSiteHost) ? next() : handler(c, next);
    };

  app.get("/favicon.svg", publicHostOnly(staticFile({ root: siteRoot, ...noCache })));
  app.get("/og.jpg", publicHostOnly(staticFile({ root: siteRoot, ...noCache })));
  app.get("/legal/*", publicHostOnly(staticFile({ root: siteRoot, ...noCache })));
  // Directory listing kit (EPIC-10 R2): the connect guide and the brand icons
  // that MCP directories link to.
  app.get("/brand/*", publicHostOnly(staticFile({ root: siteRoot, ...noCache })));
  app.get("/connect", publicHostOnly(staticFile({ root: siteRoot, path: "connect.html", ...noCache })));
  // Tester start page (E26-S26): the one-minute video, its poster and the how-to.
  app.get("/start", publicHostOnly(staticFile({ root: siteRoot, path: "start.html", ...noCache })));
  app.get("/start/*", publicHostOnly(staticFile({ root: siteRoot, ...noCache })));
  if (options.webDist) {
    app.get("/", nonPublicHostOnly(staticFile({ root: options.webDist, path: "index.html", ...noCache })));
    app.get("/account", nonPublicHostOnly(staticFile({ root: options.webDist, path: "index.html", ...noCache })));
  }
  app.get("/", publicHostOnly(staticFile({ root: siteRoot, path: "index.html", ...noCache })));
  app.get("/pricing", publicHostOnly(staticFile({ root: siteRoot, path: "index.html", ...noCache })));
  // Testers program (ZAL-A13): its own page title and description for links.
  app.get("/testers", publicHostOnly(staticFile({ root: siteRoot, path: "testers.html", ...noCache })));
}
