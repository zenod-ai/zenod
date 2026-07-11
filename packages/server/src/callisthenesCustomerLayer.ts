import {
  createCustomerLayer,
  type CustomerLayerHost,
  type CustomerLayerOptions,
} from "./customerLayer.js";
import { readCustomerSession } from "./customerSession.js";
import type { CallisthenesObservationLedger } from "./callisthenesObservationLedger.js";

export interface CallisthenesCustomerLayerOptions extends CustomerLayerOptions {
  engineUrl?: string;
  observationLedger?: CallisthenesObservationLedger;
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

  function resolveCustomer(c: Parameters<typeof readCustomerSession>[0]) {
    const session = readCustomerSession(c, env);
    if (!session) return null;
    const account = layer.accounts.resolveActiveTenantForUser(session.github_id);
    const token = account ? layer.tokenVault.get(account.account_id) : null;
    return account?.tenant_id && token ? { account, token } : null;
  }

  async function forward(c: Parameters<typeof readCustomerSession>[0], path: string) {
    const resolved = resolveCustomer(c);
    if (!resolved) return c.json({ error: "unauthorized" }, 401);
    const response = await fetch(`${engineUrl}${path}`, {
      method: c.req.method,
      headers: {
        Authorization: `Bearer ${resolved.token}`,
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

  layer.app.get("/api/callisthenes/status", async (c) => {
    const resolved = resolveCustomer(c);
    if (!resolved) return c.json({ error: "unauthorized" }, 401);
    const response = await forward(c, "/api/dashboard/status");
    if (!options.observationLedger || !response.ok) return response;
    const payload = await response.json() as Record<string, unknown>;
    const observed = options.observationLedger.read(resolved.account.tenant_id!);
    return c.json({
      ...payload,
      drafts: { available: true, records: observed.drafts, source: "front-observed rejected createPosts" },
      receipts: { available: true, records: observed.receipts, source: "front-observed verified approved sends" },
      observed_usage: observed.usage,
    });
  });
  layer.app.post("/api/callisthenes/x/app", (c) => forward(c, "/api/dashboard/x/app"));
  layer.app.post("/api/callisthenes/x/pin", (c) => forward(c, "/api/dashboard/x/pin"));
  return layer;
}
