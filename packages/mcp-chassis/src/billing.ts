import { createHmac, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import type {
  ProvisionTenantInput,
  TenantContext,
  TenantProvisioningStore,
  TenantStatus,
  UnitHonoEnv,
} from "./index.js";

export interface BillingOptions {
  store?: TenantProvisioningStore;
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  webhookSecret?: string | null;
  clock?: () => number;
  toleranceSeconds?: number;
  successPath?: string;
  cancelPath?: string;
}

interface BillingRoutesOptions extends BillingOptions {
  store: TenantProvisioningStore;
  unitName: string;
}

interface StripeLikeEvent {
  id?: string;
  type?: string;
  data?: {
    object?: Record<string, unknown>;
  };
}

export function isBillingEnabled(options?: BillingOptions): boolean {
  if (!options) return false;
  if (options.enabled !== undefined) return options.enabled;
  const env = options.env ?? process.env;
  const value = env.MCP_CHASSIS_BILLING_ENABLED ?? env.BILLING_ENABLED;
  if (value === undefined) return true;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

export function registerBillingRoutes(app: Hono<UnitHonoEnv>, options: BillingRoutesOptions): void {
  const successPath = normalizedRoute(options.successPath ?? "/checkout/success");
  const cancelPath = normalizedRoute(options.cancelPath ?? "/checkout/cancel");

  app.post("/api/billing/webhook", async (c) => {
    const rawBody = await c.req.text();
    const secret = webhookSecret(options);

    if (secret) {
      const signature = c.req.header("Stripe-Signature");
      const verified = verifyStripeWebhookSignature(rawBody, signature, secret, {
        clock: options.clock,
        toleranceSeconds: options.toleranceSeconds,
      });
      if (!verified.ok) return c.json({ error: verified.error }, 400);
    }

    const event = parseStripeLikeEvent(rawBody);
    if (!event) return c.json({ error: "invalid webhook payload" }, 400);

    const result = await applyBillingEvent(options.store, event);
    return c.json({
      received: true,
      event: event.type ?? "unknown",
      action: result.action,
      tenant: result.tenant ?? null,
      status: result.status ?? null,
    });
  });

  app.get(successPath, (c) =>
    c.html(returnPageHtml({
      title: "Checkout complete",
      heading: `${options.unitName} checkout complete`,
      body: "Your workspace is being prepared. You can close this page.",
    })),
  );

  app.get(cancelPath, (c) =>
    c.html(returnPageHtml({
      title: "Checkout canceled",
      heading: `${options.unitName} checkout canceled`,
      body: "No tenant was provisioned for this checkout.",
    })),
  );
}

export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  options: Pick<BillingOptions, "clock" | "toleranceSeconds"> = {},
): { ok: true } | { ok: false; error: string } {
  if (!signatureHeader) return { ok: false, error: "missing Stripe signature" };
  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed.timestamp || parsed.signatures.length === 0) {
    return { ok: false, error: "invalid Stripe signature" };
  }

  const now = options.clock?.() ?? Date.now();
  const toleranceMs = (options.toleranceSeconds ?? 300) * 1000;
  const age = Math.abs(now - parsed.timestamp * 1000);
  if (Number.isFinite(toleranceMs) && toleranceMs >= 0 && age > toleranceMs) {
    return { ok: false, error: "stale Stripe signature" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  const matched = parsed.signatures.some((signature) => timingSafeHexEqual(signature, expected));
  return matched ? { ok: true } : { ok: false, error: "invalid Stripe signature" };
}

async function applyBillingEvent(
  store: TenantProvisioningStore,
  event: StripeLikeEvent,
): Promise<{
  action: "ignored" | "provisioned" | "updated" | "suspended";
  tenant?: TenantContext;
  status?: TenantStatus;
}> {
  const object = event.data?.object;
  if (!object) return { action: "ignored" };

  if (isActiveSubscriptionUpdate(event.type, object)) {
    const tenantId = tenantIdFromStripeObject(object);
    const record = tenantId ? await store.setTenantStatus(tenantId, "active") : null;
    if (record) return { action: "updated", tenant: record.tenant, status: record.status ?? "active" };
  }

  if (isProvisioningEvent(event.type, object)) {
    const input = tenantInputFromStripeObject(object);
    const result = await store.provisionTenant(input);
    return { action: "provisioned", tenant: result.record.tenant, status: result.record.status ?? "active" };
  }

  if (isSuspensionEvent(event.type, object)) {
    const tenantId = tenantIdFromStripeObject(object);
    if (!tenantId) return { action: "ignored" };
    const record = await store.setTenantStatus(tenantId, "suspended");
    return record
      ? { action: "suspended", tenant: record.tenant, status: record.status ?? "suspended" }
      : { action: "ignored" };
  }

  return { action: "ignored" };
}

function isProvisioningEvent(type: string | undefined, object: Record<string, unknown>): boolean {
  if (type === "checkout.session.completed") return true;
  if (type === "customer.subscription.created") return true;
  return isActiveSubscriptionUpdate(type, object);
}

function isActiveSubscriptionUpdate(type: string | undefined, object: Record<string, unknown>): boolean {
  if (type !== "customer.subscription.updated") return false;
  const status = stringValue(object.status);
  return status === "active" || status === "trialing";
}

function isSuspensionEvent(type: string | undefined, object: Record<string, unknown>): boolean {
  if (type === "customer.subscription.deleted") return true;
  if (type !== "customer.subscription.updated") return false;
  const status = stringValue(object.status);
  return status === "canceled" || status === "incomplete_expired" || status === "past_due" || status === "unpaid";
}

function tenantInputFromStripeObject(object: Record<string, unknown>): ProvisionTenantInput {
  const metadata = metadataObject(object);
  const tenantId = tenantIdFromStripeObject(object);
  return {
    tenantId,
    name:
      stringValue(metadata.name) ??
      stringValue(metadata.tenant_name) ??
      stringValue(object.customer_email) ??
      stringValue(nestedObject(object.customer_details)?.email),
    plan: stringValue(metadata.plan) ?? stringValue(metadata.tier) ?? stringValue(object.status),
  };
}

function tenantIdFromStripeObject(object: Record<string, unknown>): string | undefined {
  const metadata = metadataObject(object);
  const raw =
    stringValue(metadata.tenant_id) ??
    stringValue(metadata.tenantId) ??
    stringValue(metadata.tenant) ??
    stringValue(object.client_reference_id) ??
    stringValue(object.customer) ??
    stringValue(object.customer_email) ??
    stringValue(object.id);
  return raw ? sanitizeTenantId(raw) : undefined;
}

function parseStripeLikeEvent(rawBody: string): StripeLikeEvent | null {
  try {
    const value: unknown = JSON.parse(rawBody);
    return value && typeof value === "object" ? (value as StripeLikeEvent) : null;
  } catch {
    return null;
  }
}

function parseStripeSignatureHeader(header: string): { timestamp: number | null; signatures: string[] } {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t" && value) {
      const parsed = Number(value);
      timestamp = Number.isFinite(parsed) ? parsed : null;
    }
    if (key === "v1" && value) signatures.push(value);
  }
  return { timestamp, signatures };
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function metadataObject(object: Record<string, unknown>): Record<string, unknown> {
  return nestedObject(object.metadata) ?? {};
}

function nestedObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeTenantId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "stripe-tenant";
}

function webhookSecret(options: BillingOptions): string | null {
  const secret = options.webhookSecret ?? options.env?.STRIPE_WEBHOOK_SECRET ?? process.env.STRIPE_WEBHOOK_SECRET ?? null;
  const trimmed = secret?.trim();
  return trimmed || null;
}

function normalizedRoute(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function returnPageHtml(input: { title: string; heading: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
</head>
<body>
  <main>
    <h1>${escapeHtml(input.heading)}</h1>
    <p>${escapeHtml(input.body)}</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
