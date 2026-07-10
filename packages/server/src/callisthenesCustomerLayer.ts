import {
  createCustomerLayer,
  type CustomerLayerHost,
  type CustomerLayerOptions,
} from "./customerLayer.js";
import { readCustomerSession } from "./customerSession.js";

export interface CallisthenesCustomerLayerOptions extends CustomerLayerOptions {
  engineUrl?: string;
}

/**
 * Callisthenes customer front, duplicated from the shipped Zenod customer layer.
 * The implementation remains shared so auth, checkout, webhook idempotency, local
 * tenant binding, session handling, and token custody cannot drift between units.
 * Only product identity, storage namespace, and canonical domain are adapted.
 */
export function createCallisthenesCustomerLayer(
  host: CustomerLayerHost,
  options: CallisthenesCustomerLayerOptions = {},
) {
  const env = options.env ?? process.env;
  const layer = createCustomerLayer(host, {
    ...options,
    product: {
      product: "callisthenes",
      unit: "callisthenes",
      defaultDomain: "https://calli.zenod.dev",
      signInToLanding: true,
    },
  });
  const engineUrl = (options.engineUrl || env.CALLISTHENES_ENGINE_URL || "http://calli-engine:8000").replace(/\/$/, "");

  async function forward(c: Parameters<typeof readCustomerSession>[0], path: string) {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = layer.accounts.resolveActiveTenantForUser(session.github_id);
    const token = account ? layer.tokenVault.get(account.account_id) : null;
    if (!account?.tenant_id || !token) return c.json({ error: "no_account" }, 404);
    const response = await fetch(`${engineUrl}${path}`, {
      method: c.req.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(c.req.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(c.req.method === "POST" ? { body: await c.req.text() } : {}),
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") || "application/json" },
    });
  }

  layer.app.get("/api/callisthenes/status", (c) => forward(c, "/api/dashboard/status"));
  layer.app.post("/api/callisthenes/x/app", (c) => forward(c, "/api/dashboard/x/app"));
  layer.app.post("/api/callisthenes/x/pin", (c) => forward(c, "/api/dashboard/x/pin"));
  return layer;
}
