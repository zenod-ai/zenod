import type { HttpBindings } from "@hono/node-server";
import { serveStatic, type ServeStaticOptions } from "@hono/node-server/serve-static";
import type { Hono, MiddlewareHandler } from "hono";

export interface StaticSurfaceOptions {
  webDist?: string;
  siteDist?: string;
}

type ServerEnv = { Bindings: HttpBindings };

function requestHost(value: string | undefined): string {
  return (value ?? "").split(",")[0]!.trim().split(":")[0]!.toLowerCase();
}

export function isPublicSiteHost(value: string | undefined): boolean {
  const host = requestHost(value);
  const configured = (process.env.ZENOD_PUBLIC_SITE_HOST ?? "zenod.dev").toLowerCase();
  return host === configured || host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function mountStaticSurfaces(app: Hono<ServerEnv>, options: StaticSurfaceOptions): void {
  const noCache: Pick<ServeStaticOptions<ServerEnv>, "onFound"> = {
    onFound: (_path, c) => c.header("Cache-Control", "no-cache, no-store, must-revalidate"),
  };
  const staticFile = (staticOptions: ServeStaticOptions<ServerEnv>) => serveStatic<ServerEnv>(staticOptions);

  if (!options.siteDist) {
    if (options.webDist) {
      app.use("/*", staticFile({ root: options.webDist, ...noCache }));
      app.get("*", staticFile({ root: options.webDist, path: "index.html", ...noCache }));
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
      return isPublicSiteHost(host) ? handler(c, next) : next();
    };
  const nonPublicHostOnly =
    (handler: MiddlewareHandler<ServerEnv>): MiddlewareHandler<ServerEnv> =>
    async (c, next) => {
      const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).hostname;
      return isPublicSiteHost(host) ? next() : handler(c, next);
    };

  app.get("/favicon.svg", publicHostOnly(staticFile({ root: siteRoot, ...noCache })));
  app.get("/og.jpg", publicHostOnly(staticFile({ root: siteRoot, ...noCache })));
  app.get("/legal/*", publicHostOnly(staticFile({ root: siteRoot, ...noCache })));
  if (options.webDist) {
    app.get("/", nonPublicHostOnly(staticFile({ root: options.webDist, path: "index.html", ...noCache })));
    app.get("/account", nonPublicHostOnly(staticFile({ root: options.webDist, path: "index.html", ...noCache })));
  }
  app.get("/", publicHostOnly(staticFile({ root: siteRoot, path: "index.html", ...noCache })));
  app.get("/pricing", publicHostOnly(staticFile({ root: siteRoot, path: "index.html", ...noCache })));
}
