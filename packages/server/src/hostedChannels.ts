import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HttpBindings } from "@hono/node-server";
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { PhylaxPortedRuntime } from "./phylaxPortedRuntime.js";
import {
  defaultPhylaxTurnBindings,
  type PhylaxTenantSettingsStore,
} from "./phylaxTenantSettings.js";
import { maskPhoneNumber } from "./whatsappConfig.js";

export type HostedWhatsAppState =
  | "off"
  | "awaiting_code"
  | "verified"
  | "degraded"
  | "paused";

export type HostedTelegramState = "off" | "connected" | "degraded";

export interface HostedChannelsView {
  whatsapp: {
    state: HostedWhatsAppState;
    senderHint: string | null;
    sharedNumber: string | null;
    verificationExpiresAt: number | null;
    lastInboundAt: number | null;
    lastReceiptAt: number | null;
  };
  telegram: {
    state: HostedTelegramState;
    identityHint: string | null;
  };
}

export type HostedChannelMutationName =
  | "whatsapp.challenge"
  | "whatsapp.test"
  | "whatsapp.disconnect";

export interface HostedChannelMutationOutcome {
  operationId: string;
  operation: HostedChannelMutationName;
  outcome: "succeeded" | "rejected" | "failed";
  at: number;
}

export interface HostedChannelChallengeResponse {
  channels: HostedChannelsView;
  challenge: {
    code: string;
    sharedNumber: string;
    expiresAt: number;
  };
  mutation: HostedChannelMutationOutcome;
}

export interface HostedChannelTestResponse {
  channels: HostedChannelsView;
  receipt: { deliveredAt: number };
  mutation: HostedChannelMutationOutcome;
}

export interface HostedChannelDisconnectResponse {
  channels: HostedChannelsView;
  mutation: HostedChannelMutationOutcome;
}

export interface HostedChannelErrorResponse {
  error: {
    code:
      | "invalid_request"
      | "sender_in_use"
      | "not_connected"
      | "channels_unavailable";
    message: string;
  };
  mutation?: HostedChannelMutationOutcome;
}

export interface HostedChannelMutationAudit {
  operationId: string;
  tenantId: string;
  operation: HostedChannelMutationName;
  outcome: HostedChannelMutationOutcome["outcome"];
  errorCode: string | null;
  at: number;
}

interface AuditRow {
  operation_id: string;
  tenant_id: string;
  operation: HostedChannelMutationName;
  outcome: HostedChannelMutationOutcome["outcome"];
  error_code: string | null;
  created_at: number;
}

function auditFromRow(row: AuditRow): HostedChannelMutationAudit {
  return {
    operationId: row.operation_id,
    tenantId: row.tenant_id,
    operation: row.operation,
    outcome: row.outcome,
    errorCode: row.error_code,
    at: row.created_at,
  };
}

/** Durable, secret-free audit of every Hosted customer channel mutation. */
export class HostedChannelMutationAuditStore {
  private readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(
      join(dataDir, "hosted-channel-mutations.sqlite"),
    );
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS hosted_channel_mutations (
        operation_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        outcome TEXT NOT NULL,
        error_code TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS hosted_channel_mutations_tenant_time
        ON hosted_channel_mutations(tenant_id, created_at DESC);
    `);
  }

  record(input: HostedChannelMutationAudit): void {
    this.db
      .prepare(
        `INSERT INTO hosted_channel_mutations
         (operation_id, tenant_id, operation, outcome, error_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(operation_id) DO NOTHING`,
      )
      .run(
        input.operationId,
        input.tenantId,
        input.operation,
        input.outcome,
        input.errorCode,
        input.at,
      );
  }

  recent(tenantId: string, limit = 20): HostedChannelMutationAudit[] {
    return (
      this.db
        .prepare(
          `SELECT operation_id, tenant_id, operation, outcome, error_code, created_at
       FROM hosted_channel_mutations
       WHERE tenant_id=?
       ORDER BY created_at DESC
       LIMIT ?`,
        )
        .all(
          tenantId,
          Math.max(1, Math.min(100, limit)),
        ) as unknown as AuditRow[]
    ).map(auditFromRow);
  }

  close(): void {
    this.db.close();
  }
}

function normalizedTenantId(value: string): string | null {
  const tenantId = value.trim();
  return tenantId &&
    tenantId.length <= 160 &&
    /^[a-zA-Z0-9._:-]+$/.test(tenantId)
    ? tenantId
    : null;
}

function safeOperationId(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,160}$/.test(value)
    ? value
    : randomUUID();
}

function tokenMatches(expected: string, provided: string): boolean {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(provided).digest();
  return timingSafeEqual(left, right);
}

function privateToken(c: Context, expected: string | undefined): boolean {
  if (!expected?.trim()) return false;
  const authorization = c.req.header("authorization") ?? "";
  const provided = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  return Boolean(provided) && tokenMatches(expected.trim(), provided);
}

function channelView(
  tenantId: string,
  settingsStore: PhylaxTenantSettingsStore,
  runtime: PhylaxPortedRuntime,
  now = Date.now(),
): HostedChannelsView {
  const settings = settingsStore.view(tenantId);
  const transport = runtime.whatsapp.status();
  const transcript = runtime.whatsappStore.recentTranscript({
    tenantId,
    sinceMs: 0,
    limit: 50,
  });
  const lastInboundAt =
    transcript.find((entry) => entry.direction === "inbound")?.at ?? null;
  const lastReceiptAt =
    transcript.find(
      (entry) => entry.direction === "outbound" && entry.status === "sent",
    )?.at ?? null;
  const awaiting = Boolean(
    settings.phoneNumber &&
    !settings.verified &&
    settings.verificationExpiresAt &&
    settings.verificationExpiresAt > now,
  );
  const transportReady = transport.state === "connected";
  const whatsappState: HostedWhatsAppState = settings.verified
    ? transportReady && settings.downstreamCredentialStatus !== "rejected"
      ? "verified"
      : "degraded"
    : awaiting
      ? "awaiting_code"
      : "off";
  const telegramReady = runtime.telegram.status().state === "connected";
  return {
    whatsapp: {
      state: whatsappState,
      senderHint: maskPhoneNumber(settings.phoneNumber),
      sharedNumber: transport.linkedNumber,
      verificationExpiresAt: settings.verificationExpiresAt,
      lastInboundAt,
      lastReceiptAt,
    },
    telegram: {
      state: settings.telegramBinding
        ? telegramReady
          ? "connected"
          : "degraded"
        : "off",
      identityHint: settings.telegramBinding,
    },
  };
}

function safeFailure(
  operationId: string,
  operation: HostedChannelMutationName,
  code: HostedChannelErrorResponse["error"]["code"],
  message: string,
  outcome: "rejected" | "failed",
  at = Date.now(),
): HostedChannelErrorResponse {
  return {
    error: { code, message },
    mutation: { operationId, operation, outcome, at },
  };
}

export function mountPhylaxHostedChannelRoutes(
  app: Hono<{ Bindings: HttpBindings }>,
  input: {
    env: NodeJS.ProcessEnv;
    settings: PhylaxTenantSettingsStore;
    runtime: PhylaxPortedRuntime;
    audit: HostedChannelMutationAuditStore;
  },
): void {
  const authorize = (c: Context) =>
    privateToken(c, input.env.ZENOD_CHANNELS_PRIVATE_TOKEN);

  app.get("/internal/zenod/channels/:tenantId", (c) => {
    if (!authorize(c)) return c.json({ error: "not found" }, 404);
    const tenantId = normalizedTenantId(c.req.param("tenantId"));
    if (!tenantId)
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: "Invalid channel request.",
          },
        },
        400,
      );
    return c.json(channelView(tenantId, input.settings, input.runtime));
  });

  app.post(
    "/internal/zenod/channels/:tenantId/whatsapp/challenge",
    async (c) => {
      if (!authorize(c)) return c.json({ error: "not found" }, 404);
      const tenantId = normalizedTenantId(c.req.param("tenantId"));
      const body = await c.req
        .json<Record<string, unknown>>()
        .catch((): Record<string, unknown> => ({}));
      const operationId = safeOperationId(body.operationId);
      const operation = "whatsapp.challenge" as const;
      const at = Date.now();
      if (
        !tenantId ||
        typeof body.sender !== "string" ||
        typeof body.downstreamUrl !== "string" ||
        typeof body.downstreamToken !== "string" ||
        !body.downstreamToken.trim()
      ) {
        const response = safeFailure(
          operationId,
          operation,
          "invalid_request",
          "Enter a valid WhatsApp sender number.",
          "rejected",
          at,
        );
        if (tenantId)
          input.audit.record({
            ...response.mutation!,
            tenantId,
            errorCode: response.error.code,
          });
        return c.json(response, 400);
      }
      try {
        input.settings.assertPhoneAvailable(tenantId, body.sender);
        const sharedNumber = input.runtime.whatsapp.status().linkedNumber;
        if (!sharedNumber) throw new Error("transport unavailable");
        input.settings.update(tenantId, {
          downstreamUrl: body.downstreamUrl,
          downstreamToken: body.downstreamToken,
          voiceDefault: "capture",
          turnBindings: defaultPhylaxTurnBindings(),
        });
        const registration = input.settings.registerPhone(
          tenantId,
          body.sender,
          "primary",
          at,
        );
        const expiresAt = registration.settings.verificationExpiresAt ?? at;
        const mutation: HostedChannelMutationOutcome = {
          operationId,
          operation,
          outcome: "succeeded",
          at,
        };
        input.audit.record({ ...mutation, tenantId, errorCode: null });
        return c.json({
          channels: channelView(tenantId, input.settings, input.runtime, at),
          challenge: { code: registration.keyword, sharedNumber, expiresAt },
          mutation,
        } satisfies HostedChannelChallengeResponse);
      } catch (error) {
        const collision =
          error instanceof Error &&
          error.message === "phone number is already registered";
        const response = safeFailure(
          operationId,
          operation,
          collision ? "sender_in_use" : "channels_unavailable",
          collision
            ? "That sender is already connected to another Zenod account."
            : "WhatsApp setup is temporarily unavailable. Try again shortly.",
          collision ? "rejected" : "failed",
          at,
        );
        input.audit.record({
          ...response.mutation!,
          tenantId,
          errorCode: response.error.code,
        });
        return c.json(response, collision ? 409 : 503);
      }
    },
  );

  app.post("/internal/zenod/channels/:tenantId/whatsapp/test", async (c) => {
    if (!authorize(c)) return c.json({ error: "not found" }, 404);
    const tenantId = normalizedTenantId(c.req.param("tenantId"));
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));
    const operationId = safeOperationId(body.operationId);
    const operation = "whatsapp.test" as const;
    const at = Date.now();
    const settings = tenantId ? input.settings.get(tenantId) : null;
    if (!tenantId || !settings?.verified || !settings.phoneNumber) {
      const response = safeFailure(
        operationId,
        operation,
        "not_connected",
        "Connect and verify your WhatsApp sender before sending a test.",
        "rejected",
        at,
      );
      if (tenantId)
        input.audit.record({
          ...response.mutation!,
          tenantId,
          errorCode: response.error.code,
        });
      return c.json(response, 409);
    }
    try {
      await input.runtime
        .delivery()
        .send(
          "whatsapp",
          settings.phoneNumber,
          "Zenod WhatsApp test: this sender is connected to your memory.",
        );
      const mutation: HostedChannelMutationOutcome = {
        operationId,
        operation,
        outcome: "succeeded",
        at,
      };
      input.audit.record({ ...mutation, tenantId, errorCode: null });
      return c.json({
        channels: channelView(tenantId, input.settings, input.runtime, at),
        receipt: { deliveredAt: at },
        mutation,
      } satisfies HostedChannelTestResponse);
    } catch {
      const response = safeFailure(
        operationId,
        operation,
        "channels_unavailable",
        "Zenod could not deliver the WhatsApp test. Try again shortly.",
        "failed",
        at,
      );
      input.audit.record({
        ...response.mutation!,
        tenantId,
        errorCode: response.error.code,
      });
      return c.json(response, 503);
    }
  });

  app.post(
    "/internal/zenod/channels/:tenantId/whatsapp/disconnect",
    async (c) => {
      if (!authorize(c)) return c.json({ error: "not found" }, 404);
      const tenantId = normalizedTenantId(c.req.param("tenantId"));
      const body = await c.req
        .json<Record<string, unknown>>()
        .catch((): Record<string, unknown> => ({}));
      const operationId = safeOperationId(body.operationId);
      const operation = "whatsapp.disconnect" as const;
      const at = Date.now();
      if (!tenantId) {
        return c.json(
          safeFailure(
            operationId,
            operation,
            "invalid_request",
            "Invalid channel request.",
            "rejected",
            at,
          ),
          400,
        );
      }
      input.settings.disconnectPhone(tenantId, at);
      const mutation: HostedChannelMutationOutcome = {
        operationId,
        operation,
        outcome: "succeeded",
        at,
      };
      input.audit.record({ ...mutation, tenantId, errorCode: null });
      return c.json({
        channels: channelView(tenantId, input.settings, input.runtime, at),
        mutation,
      } satisfies HostedChannelDisconnectResponse);
    },
  );
}

export interface HostedChannelCustomerTenant {
  tenantId: string;
  downstreamToken: string;
}

function privateChannelsBase(env: NodeJS.ProcessEnv): string | null {
  const configured = env.ZENOD_CHANNELS_URL?.trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function memoryDownstreamUrl(env: NodeJS.ProcessEnv): string {
  const configured = env.ZENOD_CHANNELS_MEMORY_URL?.trim();
  if (configured) return configured;
  return `${(env.CUSTOMER_APP_URL || env.DOMAIN || "https://cloud.zenod.dev").replace(/\/$/, "")}/mcp`;
}

async function proxyChannels(
  env: NodeJS.ProcessEnv,
  tenant: HostedChannelCustomerTenant,
  path: string,
  init?: { method: "POST"; body: Record<string, unknown> },
): Promise<{ status: number; body: unknown }> {
  const base = privateChannelsBase(env);
  const token = env.ZENOD_CHANNELS_PRIVATE_TOKEN?.trim();
  if (!base || !token) {
    return {
      status: 503,
      body: {
        error: {
          code: "channels_unavailable",
          message: "WhatsApp is temporarily unavailable. Try again shortly.",
        },
      } satisfies HostedChannelErrorResponse,
    };
  }
  try {
    const response = await fetch(
      `${base}/internal/zenod/channels/${encodeURIComponent(tenant.tenantId)}${path}`,
      {
        method: init?.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(init ? { "content-type": "application/json" } : {}),
        },
        ...(init
          ? {
              body: JSON.stringify({
                ...init.body,
                downstreamUrl: memoryDownstreamUrl(env),
                downstreamToken: tenant.downstreamToken,
              }),
            }
          : {}),
        signal: AbortSignal.timeout(8_000),
      },
    );
    const body = await response.json().catch(() => null);
    if (!body || typeof body !== "object")
      throw new Error("malformed channels response");
    return { status: response.status, body };
  } catch {
    return {
      status: 503,
      body: {
        error: {
          code: "channels_unavailable",
          message: "WhatsApp is temporarily unavailable. Try again shortly.",
        },
      } satisfies HostedChannelErrorResponse,
    };
  }
}

export function mountHostedChannelsCustomerRoutes(
  app: Hono<{ Bindings: HttpBindings }>,
  input: {
    env: NodeJS.ProcessEnv;
    resolveTenant: (
      c: Context<{ Bindings: HttpBindings }>,
    ) =>
      | HostedChannelCustomerTenant
      | null
      | Promise<HostedChannelCustomerTenant | null>;
  },
): void {
  app.get("/api/channels", async (c) => {
    const tenant = await input.resolveTenant(c);
    if (!tenant) return c.json({ error: "unauthorized" }, 401);
    const response = await proxyChannels(input.env, tenant, "");
    return c.json(response.body, response.status as ContentfulStatusCode);
  });

  for (const action of ["challenge", "test", "disconnect"] as const) {
    app.post(`/api/channels/whatsapp/${action}`, async (c) => {
      const tenant = await input.resolveTenant(c);
      if (!tenant) return c.json({ error: "unauthorized" }, 401);
      const body: { sender?: unknown } =
        action === "challenge"
          ? await c.req
              .json<{ sender?: unknown }>()
              .catch((): { sender?: unknown } => ({}))
          : {};
      const response = await proxyChannels(
        input.env,
        tenant,
        `/whatsapp/${action}`,
        {
          method: "POST",
          body: {
            operationId: randomUUID(),
            ...(action === "challenge" ? { sender: body.sender } : {}),
          },
        },
      );
      return c.json(response.body, response.status as ContentfulStatusCode);
    });
  }
}
