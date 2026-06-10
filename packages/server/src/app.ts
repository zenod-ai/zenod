import { Hono } from "hono";
import { VERSION } from "zenod";

/**
 * The Zenod HTTP app. Grows phase by phase (docs/M0-PLAN.md):
 * - /api/*  REST routes (phase 7)
 * - /mcp    Streamable HTTP MCP endpoint (phase 7)
 * - /*      built settings UI from apps/web (phase 8)
 */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/api/health", (c) =>
    c.json({ status: "ok", name: "zenod", version: VERSION }),
  );

  return app;
}
