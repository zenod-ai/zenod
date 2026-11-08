import type { HttpBindings } from "@hono/node-server";
import type { Context, Hono } from "hono";

import type { Runtime } from "./runtime.js";
import {
  deliveryJson,
  FORWARD_SCOPE,
  SUBSCRIBER_EVENT,
  SubscriberUrlError,
  subscriberUrlPolicyFromEnv,
  subscriptionJson,
  validateSubscriberUrl,
  type AddressLookup,
  type SubscriberPerson,
} from "./subscribers.js";

/**
 * The Subscribers tab's API on the tenant runtime (agent_team E42-S22), behind the workspace's own auth (the hosted
 * session bridge, or the self-hosted console token). Lists every subscriber with its 7-day log, adds a webhook by hand
 * (secret returned once, then a test event), pauses, tests and removes. Removing a connected team also revokes its grant.
 */

export const SUBSCRIBER_ACTOR_HEADER = "x-zenod-actor";

export function apiError(c: Context, status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 503, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return c.json({ error: { code, message, ...extra } }, status);
}

export function subscribersDisabled(c: Context): Response {
  return apiError(c, 503, "subscribers_disabled", "Subscribers are not switched on for this Zenod.");
}

/** The signed-in person, as the hosted bridge passes it; absent on self-hosted. Cosmetic only (a label on the card). */
function actor(c: Context): SubscriberPerson {
  const raw = c.req.header(SUBSCRIBER_ACTOR_HEADER);
  if (!raw) return { name: null, email: null };
  try {
    const parsed = JSON.parse(raw) as { name?: unknown; email?: unknown };
    return {
      name: typeof parsed.name === "string" ? parsed.name.slice(0, 120) : null,
      email: typeof parsed.email === "string" ? parsed.email.slice(0, 200) : null,
    };
  } catch {
    return { name: null, email: null };
  }
}

export function mountSubscriberRoutes(
  app: Hono<{ Bindings: HttpBindings }>,
  runtime: Runtime,
  options: { lookup?: AddressLookup; env?: NodeJS.ProcessEnv } = {},
): void {
  const views = () => {
    const store = runtime.subscribers!;
    return store.list().map((sub) => ({ ...subscriptionJson(store.view(sub)), deliveries: store.deliveries(sub.id).map(deliveryJson) }));
  };

  // EPIC-21 V1: apps allowed to forward their voice notes in. They hold a grant, not a subscription, so they are listed apart.
  const forwarders = () => runtime.subscribers!.grants()
    .filter((grant) => grant.scope.split(/\s+/).includes(FORWARD_SCOPE))
    .map((grant) => ({ grant_id: grant.id, name: grant.clientName, scope: grant.scope, account: grant.account, created_at: grant.createdAt }));

  app.get("/api/subscribers", (c) => {
    if (!runtime.subscribers) return subscribersDisabled(c);
    runtime.subscribers.pruneDeliveries();
    return c.json({ subscribers: views(), forwarders: forwarders(), event: SUBSCRIBER_EVENT });
  });

  app.delete("/api/subscribers/forwarders/:grantId", (c) => {
    const store = runtime.subscribers;
    if (!store) return subscribersDisabled(c);
    const grant = store.grant(c.req.param("grantId"));
    if (!grant || !grant.scope.split(/\s+/).includes(FORWARD_SCOPE)) return apiError(c, 404, "not_found", "No such forwarding app.");
    // The token stops at once; a subscription made with the same grant goes with it.
    for (const sub of store.forGrant(grant.id)) runtime.subscriberDispatcher?.cancel(sub.id);
    store.revokeGrant(grant.id);
    return c.body(null, 204);
  });

  app.post("/api/subscribers", async (c) => {
    const store = runtime.subscribers;
    const dispatcher = runtime.subscriberDispatcher;
    if (!store || !dispatcher) return subscribersDisabled(c);
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(c, 400, "invalid_request", "Send a JSON body.");
    const event = body.event ?? SUBSCRIBER_EVENT;
    if (event !== SUBSCRIBER_EVENT) return apiError(c, 400, "unsupported_event", `Only ${SUBSCRIBER_EVENT} is supported.`);
    if (body.name !== undefined && typeof body.name !== "string") return apiError(c, 400, "invalid_request", "name must be a string.");
    let url: URL;
    try {
      url = await validateSubscriberUrl(body.url, { tenantId: runtime.tenantId, policy: options.env ? subscriberUrlPolicyFromEnv(options.env) : dispatcher.policy, lookup: options.lookup });
    } catch (error) {
      if (error instanceof SubscriberUrlError) return apiError(c, 422, "url_not_allowed", error.message);
      throw error;
    }
    const name = (typeof body.name === "string" && body.name.trim()) || url.hostname;
    const { subscription, signingSecret } = store.create({
      name,
      kind: "webhook",
      url: url.toString(),
      event: SUBSCRIBER_EVENT,
      via: "manual",
      createdBy: actor(c),
    });
    // The form promises a test event as soon as the webhook is created.
    const test = await dispatcher.sendTest(subscription);
    c.header("Cache-Control", "no-store");
    return c.json({ subscription: subscriptionJson(store.view(subscription)), signing_secret: signingSecret, test_delivery: deliveryJson(test) }, 201);
  });

  app.patch("/api/subscribers/:id", async (c) => {
    const store = runtime.subscribers;
    if (!store) return subscribersDisabled(c);
    const body = await c.req.json<{ enabled?: unknown }>().catch(() => null);
    if (!body || typeof body.enabled !== "boolean") return apiError(c, 400, "invalid_request", "Send {\"enabled\": true|false}.");
    const sub = store.setEnabled(c.req.param("id"), body.enabled);
    if (!sub) return apiError(c, 404, "not_found", "No such subscriber.");
    return c.json({ subscription: subscriptionJson(store.view(sub)) });
  });

  app.post("/api/subscribers/:id/test", async (c) => {
    const store = runtime.subscribers;
    const dispatcher = runtime.subscriberDispatcher;
    if (!store || !dispatcher) return subscribersDisabled(c);
    const sub = store.get(c.req.param("id"));
    if (!sub) return apiError(c, 404, "not_found", "No such subscriber.");
    const delivery = await dispatcher.sendTest(sub);
    return c.json({ delivery: deliveryJson(delivery), subscription: subscriptionJson(store.view(sub)) });
  });

  app.delete("/api/subscribers/:id", (c) => {
    const store = runtime.subscribers;
    if (!store) return subscribersDisabled(c);
    const id = c.req.param("id");
    runtime.subscriberDispatcher?.cancel(id);
    // Removing a connected team deletes its subscription, signing secret, log and grant: its token stops at once.
    if (!store.delete(id)) return apiError(c, 404, "not_found", "No such subscriber.");
    return c.body(null, 204);
  });
}
