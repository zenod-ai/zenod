import type { Context, Hono } from "hono";
import { CallError, createMemoryCall, type CallStore, type CallTenant, type Minter, type PlatformMeter } from "./memoryCall.js";

/**
 * The call button's routes (EPIC-14 S8), for the signed-in customer's own tenant only (`resolve`,
 * as for the inbox and personas): the button's state, start (mint a 1-minute client key under the
 * caps), heartbeat, usage, the voice's tools, hang up, and Keep (the transcript as a memory).
 */

export type CallResolve = (c: Context) => Promise<{ store: CallStore; tenant: CallTenant; platform?: PlatformMeter; tenantId?: string } | { response: Response }>;

export function registerMemoryCallRoutes(app: Hono<any>, resolve: CallResolve, options: { key: () => string | undefined; minter: (key: string) => Minter }): void {
  const service = async (c: Context) => {
    const found = await resolve(c);
    if ("response" in found) return found;
    const key = options.key();
    return { call: createMemoryCall({ store: found.store, tenant: found.tenant, key, platform: found.platform, tenantId: found.tenantId, ...(key ? { mint: options.minter(key) } : {}) }) };
  };
  const fail = (c: Context, error: unknown) => {
    if (error instanceof CallError) return c.json({ error: error.code, code: error.code, message: error.message }, error.status);
    console.warn(`[call] request failed: ${error instanceof Error ? error.message : String(error)}`);
    return c.json({ error: "call_unavailable", message: "The call could not do that just now. Try again in a moment." }, 503);
  };
  const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  app.get("/api/console/call", async (c) => {
    const s = await service(c);
    if ("response" in s) return s.response;
    try {
      return c.json(s.call.state());
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/api/console/call/start", async (c) => {
    const s = await service(c);
    if ("response" in s) return s.response;
    try {
      c.header("cache-control", "no-store");
      return c.json(await s.call.start());
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/api/console/call/:id/beat", async (c) => {
    const s = await service(c);
    if ("response" in s) return s.response;
    try {
      return c.json(s.call.beat(c.req.param("id")));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/api/console/call/:id/usage", async (c) => {
    const s = await service(c);
    if ("response" in s) return s.response;
    try {
      return c.json(s.call.usage(c.req.param("id"), await body(c)));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/api/console/call/:id/tool", async (c) => {
    const s = await service(c);
    if ("response" in s) return s.response;
    try {
      const b = await body(c);
      return c.json(await s.call.tool(c.req.param("id"), b.name, b.arguments));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/api/console/call/:id/end", async (c) => {
    const s = await service(c);
    if ("response" in s) return s.response;
    try {
      return c.json(s.call.end(c.req.param("id"), await body(c)));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/api/console/call/:id/keep", async (c) => {
    const s = await service(c);
    if ("response" in s) return s.response;
    try {
      return c.json(s.call.keep(c.req.param("id")), 202);
    } catch (error) {
      return fail(c, error);
    }
  });
}
