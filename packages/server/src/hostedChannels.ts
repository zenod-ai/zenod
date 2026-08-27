import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
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
import { normalizeTelegramEntry } from "./telegramConfig.js";
import {
  maskPhoneNumber,
  normalizeWhatsAppIdentifier,
} from "./whatsappConfig.js";

export type HostedWhatsAppState =
  | "off"
  | "awaiting_code"
  | "verified"
  | "degraded"
  | "paused";
export type HostedTelegramState =
  | "off"
  | "awaiting_code"
  | "connected"
  | "degraded";
export interface HostedChannelsView {
  whatsapp: {
    state: HostedWhatsAppState;
    senderHint: string | null;
    sharedNumber: string | null;
    verificationExpiresAt: number | null;
    lastInboundAt: number | null;
    lastReceiptAt: number | null;
    revision: string;
  };
  telegram: {
    state: HostedTelegramState;
    identityHint: string | null;
    verificationExpiresAt: number | null;
    revision: string;
  };
}
export type HostedChannelMutationName =
  | "whatsapp.challenge"
  | "whatsapp.verify"
  | "whatsapp.test"
  | "whatsapp.disconnect"
  | "telegram.connect"
  | "telegram.verify"
  | "telegram.test"
  | "telegram.disconnect";
export interface HostedChannelMutationOutcome {
  operationId: string;
  operation: HostedChannelMutationName;
  outcome: "succeeded" | "rejected" | "failed";
  at: number;
}
export interface HostedChannelChallengeResponse {
  channels: HostedChannelsView;
  challenge: { code: string; sharedNumber: string; expiresAt: number };
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
export interface HostedChannelConnectResponse {
  channels: HostedChannelsView;
  challenge?: { code: string; expiresAt: number };
  mutation: HostedChannelMutationOutcome;
}
export interface HostedChannelErrorResponse {
  error: {
    code:
      | "invalid_request"
      | "sender_in_use"
      | "identity_in_use"
      | "already_connected"
      | "not_connected"
      | "operation_conflict"
      | "operation_in_progress"
      | "channels_unavailable";
    message: string;
    retryDisposition?: "retry_same_operation" | "retry_new_operation";
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

interface OperationRow {
  operation_id: string;
  tenant_id: string;
  operation: HostedChannelMutationName;
  request_hash: string | null;
  target_hash: string | null;
  claim_binding_revision: string | null;
  terminal_binding_revision: string | null;
  state: string | null;
  outcome: HostedChannelMutationOutcome["outcome"];
  error_code: string | null;
  http_status: number | null;
  result_json: string | null;
  created_at: number;
}
type ClaimedOperation =
  | { kind: "claimed" }
  | { kind: "pending" }
  | { kind: "conflict" }
  | { kind: "replay"; status: number; body: unknown };

/** Durable operation claim, terminal replay, and secret-free mutation audit. */
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
        request_hash TEXT,
        target_hash TEXT,
        claim_binding_revision TEXT,
        terminal_binding_revision TEXT,
        state TEXT,
        outcome TEXT NOT NULL,
        error_code TEXT,
        http_status INTEGER,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS hosted_channel_mutations_tenant_time
        ON hosted_channel_mutations(tenant_id, created_at DESC);
    `);
    const columns = new Set(
      (
        this.db
          .prepare("PRAGMA table_info(hosted_channel_mutations)")
          .all() as Array<{ name: string }>
      ).map(({ name }) => name),
    );
    for (const [name, type] of [
      ["request_hash", "TEXT"],
      ["target_hash", "TEXT"],
      ["claim_binding_revision", "TEXT"],
      ["terminal_binding_revision", "TEXT"],
      ["state", "TEXT"],
      ["http_status", "INTEGER"],
      ["result_json", "TEXT"],
      ["completed_at", "INTEGER"],
    ] as const) {
      if (!columns.has(name))
        this.db.exec(
          `ALTER TABLE hosted_channel_mutations ADD COLUMN ${name} ${type}`,
        );
    }
    this.db.exec(
      "UPDATE hosted_channel_mutations SET state='terminal', completed_at=created_at WHERE state IS NULL",
    );
  }

  claim(input: {
    operationId: string;
    tenantId: string;
    operation: HostedChannelMutationName;
    requestHash: string;
    targetHash: string;
    bindingRevision: string;
    at: number;
  }): ClaimedOperation {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT * FROM hosted_channel_mutations WHERE operation_id=?")
        .get(input.operationId) as OperationRow | undefined;
      if (row) {
        this.db.exec("COMMIT");
        if (
          row.tenant_id !== input.tenantId ||
          row.operation !== input.operation ||
          row.request_hash !== input.requestHash
        ) {
          return { kind: "conflict" };
        }
        if (row.state === "terminal") {
          if (
            row.http_status &&
            row.result_json &&
            row.terminal_binding_revision === input.bindingRevision
          ) {
            return {
              kind: "replay",
              status: row.http_status,
              body: JSON.parse(row.result_json) as unknown,
            };
          }
          return { kind: "conflict" };
        }
        if (row.target_hash !== input.targetHash) {
          return { kind: "conflict" };
        }
        return row.claim_binding_revision === input.bindingRevision
          ? { kind: "pending" }
          : { kind: "conflict" };
      }
      this.db
        .prepare(
          `INSERT INTO hosted_channel_mutations
          (operation_id, tenant_id, operation, request_hash, target_hash,
           claim_binding_revision, state, outcome, error_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'claimed', 'failed', NULL, ?)`,
        )
        .run(
          input.operationId,
          input.tenantId,
          input.operation,
          input.requestHash,
          input.targetHash,
          input.bindingRevision,
          input.at,
        );
      this.db.exec("COMMIT");
      return { kind: "claimed" };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  terminal(input: {
    operationId: string;
    outcome: HostedChannelMutationOutcome["outcome"];
    errorCode: string | null;
    status: number;
    body: unknown;
    bindingRevision: string;
    at: number;
  }): void {
    this.db
      .prepare(
        `UPDATE hosted_channel_mutations
       SET state='terminal', outcome=?, error_code=?, http_status=?, result_json=?,
           terminal_binding_revision=?, completed_at=?
       WHERE operation_id=? AND state='claimed'`,
      )
      .run(
        input.outcome,
        input.errorCode,
        input.status,
        JSON.stringify(input.body),
        input.bindingRevision,
        input.at,
        input.operationId,
      );
  }

  replay(operationId: string): { status: number; body: unknown } | null {
    const row = this.db
      .prepare(
        "SELECT http_status, result_json, state FROM hosted_channel_mutations WHERE operation_id=?",
      )
      .get(operationId) as
      | Pick<OperationRow, "http_status" | "result_json" | "state">
      | undefined;
    if (row?.state !== "terminal" || !row.http_status || !row.result_json)
      return null;
    return {
      status: row.http_status,
      body: JSON.parse(row.result_json) as unknown,
    };
  }

  record(input: HostedChannelMutationAudit): void {
    this.db
      .prepare(
        `INSERT INTO hosted_channel_mutations
        (operation_id, tenant_id, operation, request_hash, state, outcome, error_code,
         http_status, result_json, created_at, completed_at)
       VALUES (?, ?, ?, '', 'terminal', ?, ?, 200, '{}', ?, ?)
       ON CONFLICT(operation_id) DO NOTHING`,
      )
      .run(
        input.operationId,
        input.tenantId,
        input.operation,
        input.outcome,
        input.errorCode,
        input.at,
        input.at,
      );
  }

  recordVerification(
    channel: "whatsapp" | "telegram",
    tenantId: string,
    sender: string,
    bindingRevision: string,
    at = Date.now(),
  ): void {
    const senderHash = createHash("sha256")
      .update(sender)
      .digest("hex")
      .slice(0, 20);
    this.record({
      operationId: `verify-${channel}-${tenantId}-${senderHash}-${bindingRevision}`,
      tenantId,
      operation: `${channel}.verify` as HostedChannelMutationName,
      outcome: "succeeded",
      errorCode: null,
      at,
    });
  }

  recent(tenantId: string, limit = 20): HostedChannelMutationAudit[] {
    const rows = this.db
      .prepare(
        `SELECT operation_id, tenant_id, operation, outcome, error_code, created_at
       FROM hosted_channel_mutations WHERE tenant_id=? AND state='terminal'
       ORDER BY created_at DESC LIMIT ?`,
      )
      .all(tenantId, Math.max(1, Math.min(100, limit))) as unknown as Array<{
      operation_id: string;
      tenant_id: string;
      operation: HostedChannelMutationName;
      outcome: HostedChannelMutationOutcome["outcome"];
      error_code: string | null;
      created_at: number;
    }>;
    return rows.map((row) => ({
      operationId: row.operation_id,
      tenantId: row.tenant_id,
      operation: row.operation,
      outcome: row.outcome,
      errorCode: row.error_code,
      at: row.created_at,
    }));
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
function safeOperationId(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{8,160}$/.test(value)
    ? value
    : null;
}
function requestHash(
  operation: HostedChannelMutationName,
  body: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ operation, body }))
    .digest("hex");
}
function targetDigest(value: string | null): string {
  return createHash("sha256")
    .update(value ?? "")
    .digest("hex");
}
function tokenMatches(expected: string, provided: string): boolean {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(provided).digest();
  return timingSafeEqual(left, right);
}
function privateToken(c: Context, expected: string | undefined): boolean {
  if (!expected?.trim()) return false;
  const provided =
    (c.req.header("authorization") ?? "")
      .match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim() ?? "";
  return Boolean(provided) && tokenMatches(expected.trim(), provided);
}
function normalizeHostedPhone(value: unknown): string | null {
  if (typeof value !== "string" || !/^\s*\+?[\d ()-]+\s*$/.test(value))
    return null;
  const normalized = normalizeWhatsAppIdentifier(value);
  return /^\d{8,15}$/.test(normalized) ? normalized : null;
}
function normalizeHostedTelegram(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length > 64) return null;
  const normalized = normalizeTelegramEntry(value);
  const numeric = /^-?\d{1,20}$/.test(normalized);
  if (
    !normalized ||
    (numeric && !Number.isSafeInteger(Number(normalized))) ||
    (!numeric && !/^[a-z0-9_]{5,32}$/.test(normalized))
  )
    return null;
  return normalized;
}

const CHALLENGE_ANIMALS = [
  "badger",
  "falcon",
  "otter",
  "panda",
  "raven",
  "tiger",
  "whale",
  "wolf",
] as const;
function challengeCode(
  secret: string,
  tenantId: string,
  operationId: string,
  sender: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(`${tenantId}\n${operationId}\n${sender}`)
    .digest();
  return `${10 + ((digest[0] ?? 0) % 90)}-${CHALLENGE_ANIMALS[(digest[1] ?? 0) % CHALLENGE_ANIMALS.length] ?? "otter"}`;
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
  const whatsappState: HostedWhatsAppState = settings.verified
    ? transport.state === "connected" &&
      settings.downstreamCredentialStatus !== "rejected"
      ? "verified"
      : "degraded"
    : awaiting
      ? "awaiting_code"
      : "off";
  return {
    whatsapp: {
      state: whatsappState,
      senderHint: maskPhoneNumber(settings.phoneNumber),
      sharedNumber: transport.linkedNumber,
      verificationExpiresAt: settings.verificationExpiresAt,
      lastInboundAt,
      lastReceiptAt,
      revision: settings.whatsappBindingRevision,
    },
    telegram: {
      state: settings.telegramBinding
        ? runtime.telegram.status().state === "connected"
          ? "connected"
          : "degraded"
        : settings.telegramPendingIdentity &&
            settings.telegramVerificationExpiresAt &&
            settings.telegramVerificationExpiresAt > now
          ? "awaiting_code"
          : "off",
      identityHint:
        settings.telegramBinding || settings.telegramPendingIdentity
          ? `@${(
              settings.telegramBinding
                ? settings.telegramIdentityHint ?? settings.telegramBinding
                : settings.telegramPendingIdentity
            )!.replace(/^@/, "")}`
          : null,
      verificationExpiresAt: settings.telegramVerificationExpiresAt,
      revision: settings.telegramBindingRevision,
    },
  };
}

function failure(
  operationId: string,
  operation: HostedChannelMutationName,
  code: HostedChannelErrorResponse["error"]["code"],
  message: string,
  outcome: "rejected" | "failed",
  at = Date.now(),
): HostedChannelErrorResponse {
  return {
    error: {
      code,
      message,
      retryDisposition:
        code === "operation_in_progress"
          ? "retry_same_operation"
          : "retry_new_operation",
    },
    mutation: { operationId, operation, outcome, at },
  };
}

async function waitForTerminal(
  store: HostedChannelMutationAuditStore,
  operationId: string,
) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const replay = store.replay(operationId);
    if (replay) return replay;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

async function executeOnce(
  store: HostedChannelMutationAuditStore,
  input: {
    operationId: string;
    tenantId: string;
    operation: HostedChannelMutationName;
    requestBody: Record<string, unknown>;
    target: string | null;
    bindingRevision: () => string;
    deriveChallenge?: () => string;
  },
  effect: () =>
    | Promise<{ status: number; body: unknown }>
    | { status: number; body: unknown },
): Promise<{ status: number; body: unknown }> {
  const at = Date.now();
  const claimRevision = input.bindingRevision();
  const claim = store.claim({
    operationId: input.operationId,
    tenantId: input.tenantId,
    operation: input.operation,
    requestHash: requestHash(input.operation, input.requestBody),
    targetHash: targetDigest(input.target),
    bindingRevision: claimRevision,
    at,
  });
  const rehydrate = (result: { status: number; body: unknown }) => {
    if (
      !input.deriveChallenge ||
      !result.body ||
      typeof result.body !== "object"
    )
      return result;
    const root = result.body as Record<string, unknown>;
    if (!root.challenge || typeof root.challenge !== "object") return result;
    return {
      ...result,
      body: {
        ...root,
        challenge: {
          ...(root.challenge as object),
          code: input.deriveChallenge(),
        },
      },
    };
  };
  if (claim.kind === "replay") return rehydrate(claim);
  if (claim.kind === "conflict") {
    return {
      status: 409,
      body: failure(
        input.operationId,
        input.operation,
        "operation_conflict",
        "This request key was already used for a different action.",
        "rejected",
        at,
      ),
    };
  }
  if (claim.kind === "pending") {
    const replay = await waitForTerminal(store, input.operationId);
    return replay
      ? rehydrate(replay)
      : {
          status: 409,
          body: failure(
            input.operationId,
            input.operation,
            "operation_in_progress",
            "This channel action is still in progress. Retry with the same request key.",
            "failed",
            at,
          ),
        };
  }
  let result: { status: number; body: unknown };
  try {
    result = await effect();
  } catch {
    result = {
      status: 503,
      body: failure(
        input.operationId,
        input.operation,
        "channels_unavailable",
        "This channel action is temporarily unavailable. Try again shortly.",
        "failed",
      ),
    };
  }
  const response = result.body as {
    mutation?: HostedChannelMutationOutcome;
    error?: { code?: string };
  };
  const storedBody =
    input.deriveChallenge && result.body && typeof result.body === "object"
      ? {
          ...(result.body as Record<string, unknown>),
          challenge: {
            ...((result.body as { challenge?: object }).challenge ?? {}),
            code: "__derived__",
          },
        }
      : result.body;
  store.terminal({
    operationId: input.operationId,
    outcome: response.mutation?.outcome ?? "failed",
    errorCode: response.error?.code ?? null,
    status: result.status,
    body: storedBody,
    bindingRevision: input.bindingRevision(),
    at: response.mutation?.at ?? Date.now(),
  });
  return result;
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
  const parse = (c: Context): Promise<Record<string, unknown>> =>
    c.req
      .json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));

  app.get("/internal/zenod/channels/:tenantId", (c) => {
    if (!authorize(c)) return c.json({ error: "not found" }, 404);
    const tenantId = normalizedTenantId(c.req.param("tenantId") ?? "");
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
      const tenantId = normalizedTenantId(c.req.param("tenantId") ?? "");
      const body = await parse(c);
      const operationId = safeOperationId(body.operationId);
      const operation = "whatsapp.challenge" as const;
      const sender =
        normalizeHostedPhone(body.sender) ??
        (tenantId ? input.settings.get(tenantId).phoneNumber : null);
      if (
        !tenantId ||
        !operationId ||
        !sender ||
        typeof body.downstreamUrl !== "string" ||
        typeof body.downstreamToken !== "string" ||
        !body.downstreamToken.trim()
      ) {
        return c.json(
          failure(
            operationId ?? randomUUID(),
            operation,
            "invalid_request",
            "Enter a valid WhatsApp sender number.",
            "rejected",
          ),
          400,
        );
      }
      const code = challengeCode(
        input.env.ZENOD_CHANNELS_PRIVATE_TOKEN ?? "",
        tenantId,
        operationId,
        sender,
      );
      const result = await executeOnce(
        input.audit,
        {
          operationId,
          tenantId,
          operation,
          requestBody: { sender, downstreamUrl: body.downstreamUrl },
          target: sender,
          bindingRevision: () =>
            input.settings.bindingRevision(tenantId, "whatsapp"),
          deriveChallenge: () => code,
        },
        () => {
          const at = Date.now();
          try {
            const current = input.settings.get(tenantId);
            if (current.verified && current.phoneNumber) {
              return {
                status: 409,
                body: failure(
                  operationId,
                  operation,
                  "already_connected",
                  "Disconnect the current sender before connecting another one.",
                  "rejected",
                  at,
                ),
              };
            }
            input.settings.assertPhoneAvailable(tenantId, sender);
            const sharedNumber = input.runtime.whatsapp.status().linkedNumber;
            if (!sharedNumber) throw new Error("transport unavailable");
            input.settings.update(tenantId, {
              downstreamUrl: body.downstreamUrl as string,
              downstreamToken: body.downstreamToken as string,
              voiceDefault: "capture",
              turnBindings: defaultPhylaxTurnBindings(),
            });
            const registration = input.settings.registerPhone(
              tenantId,
              sender,
              "primary",
              at,
              code,
            );
            const mutation: HostedChannelMutationOutcome = {
              operationId,
              operation,
              outcome: "succeeded",
              at,
            };
            return {
              status: 200,
              body: {
                channels: channelView(
                  tenantId,
                  input.settings,
                  input.runtime,
                  at,
                ),
                challenge: {
                  code,
                  sharedNumber,
                  expiresAt: registration.settings.verificationExpiresAt ?? at,
                },
                mutation,
              } satisfies HostedChannelChallengeResponse,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            const collision = message === "phone number is already registered";
            const invalid = message === "invalid WhatsApp phone number";
            return {
              status: invalid ? 400 : collision ? 409 : 503,
              body: failure(
                operationId,
                operation,
                invalid
                  ? "invalid_request"
                  : collision
                    ? "sender_in_use"
                    : "channels_unavailable",
                invalid
                  ? "Enter a valid WhatsApp sender number."
                  : collision
                    ? "That sender is already connected to another Zenod account."
                    : "WhatsApp setup is temporarily unavailable. Try again shortly.",
                invalid || collision ? "rejected" : "failed",
                at,
              ),
            };
          }
        },
      );
      return c.json(result.body, result.status as ContentfulStatusCode);
    },
  );

  const testRoute =
    (channel: "whatsapp" | "telegram") => async (c: Context) => {
      if (!authorize(c)) return c.json({ error: "not found" }, 404);
      const tenantId = normalizedTenantId(c.req.param("tenantId") ?? "");
      const body = await parse(c);
      const operationId = safeOperationId(body.operationId);
      const operation = `${channel}.test` as HostedChannelMutationName;
      if (!tenantId || !operationId)
        return c.json(
          failure(
            operationId ?? randomUUID(),
            operation,
            "invalid_request",
            "Invalid channel request.",
            "rejected",
          ),
          400,
        );
      const result = await executeOnce(
        input.audit,
        {
          operationId,
          tenantId,
          operation,
          requestBody: {},
          target:
            channel === "whatsapp"
              ? input.settings.get(tenantId).phoneNumber
              : input.settings.get(tenantId).telegramBinding,
          bindingRevision: () =>
            input.settings.bindingRevision(tenantId, channel),
        },
        async () => {
          const at = Date.now();
          const settings = input.settings.get(tenantId);
          const recipient =
            channel === "whatsapp"
              ? settings.verified
                ? settings.phoneNumber
                : null
              : settings.telegramBinding;
          if (!recipient)
            return {
              status: 409,
              body: failure(
                operationId,
                operation,
                "not_connected",
                `Connect ${channel === "whatsapp" ? "WhatsApp" : "Telegram"} before sending a test.`,
                "rejected",
                at,
              ),
            };
          try {
            await input.runtime
              .delivery()
              .send(
                channel,
                recipient,
                channel === "whatsapp"
                  ? "Zenod WhatsApp test: this sender is connected to your memory."
                  : "Zenod Telegram test: this identity is connected to your memory.",
              );
            const mutation: HostedChannelMutationOutcome = {
              operationId,
              operation,
              outcome: "succeeded",
              at,
            };
            return {
              status: 200,
              body: {
                channels: channelView(
                  tenantId,
                  input.settings,
                  input.runtime,
                  at,
                ),
                receipt: { deliveredAt: at },
                mutation,
              } satisfies HostedChannelTestResponse,
            };
          } catch {
            return {
              status: 503,
              body: failure(
                operationId,
                operation,
                "channels_unavailable",
                `Zenod could not deliver the ${channel === "whatsapp" ? "WhatsApp" : "Telegram"} test. Try again shortly.`,
                "failed",
                at,
              ),
            };
          }
        },
      );
      return c.json(result.body, result.status as ContentfulStatusCode);
    };
  app.post(
    "/internal/zenod/channels/:tenantId/whatsapp/test",
    testRoute("whatsapp"),
  );
  app.post(
    "/internal/zenod/channels/:tenantId/telegram/test",
    testRoute("telegram"),
  );

  const disconnectRoute =
    (channel: "whatsapp" | "telegram") => async (c: Context) => {
      if (!authorize(c)) return c.json({ error: "not found" }, 404);
      const tenantId = normalizedTenantId(c.req.param("tenantId") ?? "");
      const body = await parse(c);
      const operationId = safeOperationId(body.operationId);
      const operation = `${channel}.disconnect` as HostedChannelMutationName;
      if (!tenantId || !operationId)
        return c.json(
          failure(
            operationId ?? randomUUID(),
            operation,
            "invalid_request",
            "Invalid channel request.",
            "rejected",
          ),
          400,
        );
      const result = await executeOnce(
        input.audit,
        {
          operationId,
          tenantId,
          operation,
          requestBody: {},
          target:
            channel === "whatsapp"
              ? input.settings.get(tenantId).phoneNumber
              : (input.settings.get(tenantId).telegramBinding ??
                input.settings.get(tenantId).telegramPendingIdentity),
          bindingRevision: () =>
            input.settings.bindingRevision(tenantId, channel),
        },
        () => {
          const at = Date.now();
          if (channel === "whatsapp")
            input.settings.disconnectPhone(tenantId, at);
          else input.settings.disconnectTelegram(tenantId);
          const mutation: HostedChannelMutationOutcome = {
            operationId,
            operation,
            outcome: "succeeded",
            at,
          };
          return {
            status: 200,
            body: {
              channels: channelView(
                tenantId,
                input.settings,
                input.runtime,
                at,
              ),
              mutation,
            } satisfies HostedChannelDisconnectResponse,
          };
        },
      );
      return c.json(result.body, result.status as ContentfulStatusCode);
    };
  app.post(
    "/internal/zenod/channels/:tenantId/whatsapp/disconnect",
    disconnectRoute("whatsapp"),
  );
  app.post(
    "/internal/zenod/channels/:tenantId/telegram/disconnect",
    disconnectRoute("telegram"),
  );

  app.post("/internal/zenod/channels/:tenantId/telegram/connect", async (c) => {
    if (!authorize(c)) return c.json({ error: "not found" }, 404);
    const tenantId = normalizedTenantId(c.req.param("tenantId") ?? "");
    const body = await parse(c);
    const operationId = safeOperationId(body.operationId);
    const identity =
      normalizeHostedTelegram(body.identity) ??
      (tenantId ? input.settings.get(tenantId).telegramPendingIdentity : null);
    const operation = "telegram.connect" as const;
    if (
      !tenantId ||
      !operationId ||
      !identity ||
      typeof body.downstreamUrl !== "string" ||
      typeof body.downstreamToken !== "string" ||
      !body.downstreamToken.trim()
    ) {
      return c.json(
        failure(
          operationId ?? randomUUID(),
          operation,
          "invalid_request",
          "Enter a valid Telegram username or numeric chat ID.",
          "rejected",
        ),
        400,
      );
    }
    const code = challengeCode(
      input.env.ZENOD_CHANNELS_PRIVATE_TOKEN ?? "",
      tenantId,
      operationId,
      identity,
    );
    const result = await executeOnce(
      input.audit,
      {
        operationId,
        tenantId,
        operation,
        requestBody: { identity, downstreamUrl: body.downstreamUrl },
        target: identity,
        bindingRevision: () =>
          input.settings.bindingRevision(tenantId, "telegram"),
        deriveChallenge: () => code,
      },
      () => {
        const at = Date.now();
        try {
          const current = input.settings.get(tenantId);
          if (current.telegramBinding) {
            return {
              status: 409,
              body: failure(
                operationId,
                operation,
                "already_connected",
                "Disconnect the current Telegram identity before connecting another one.",
                "rejected",
                at,
              ),
            };
          }
          input.settings.assertTelegramAvailable(tenantId, identity);
          input.settings.update(tenantId, {
            downstreamUrl: body.downstreamUrl as string,
            downstreamToken: body.downstreamToken as string,
            voiceDefault: "capture",
            turnBindings: defaultPhylaxTurnBindings(),
          });
          const registration = input.settings.registerTelegram(
            tenantId,
            identity,
            at,
            code,
          );
          const mutation: HostedChannelMutationOutcome = {
            operationId,
            operation,
            outcome: "succeeded",
            at,
          };
          return {
            status: 200,
            body: {
              channels: channelView(
                tenantId,
                input.settings,
                input.runtime,
                at,
              ),
              challenge: {
                code,
                expiresAt:
                  registration.settings.telegramVerificationExpiresAt ?? at,
              },
              mutation,
            } satisfies HostedChannelConnectResponse,
          };
        } catch (error) {
          const collision =
            error instanceof Error &&
            error.message === "Telegram identity is already registered";
          return {
            status: collision ? 409 : 400,
            body: failure(
              operationId,
              operation,
              collision ? "identity_in_use" : "invalid_request",
              collision
                ? "That Telegram identity is already connected to another Zenod account."
                : "Enter a valid Telegram username or numeric chat ID.",
              "rejected",
              at,
            ),
          };
        }
      },
    );
    return c.json(result.body, result.status as ContentfulStatusCode);
  });
}

export interface HostedChannelCustomerTenant {
  tenantId: string;
  downstreamToken: string;
  /** ZAL-10 admission may pause processing without destroying channel bindings. */
  processingPaused?: boolean;
}

function configuredPrivateOrigin(env: NodeJS.ProcessEnv): string | null {
  const configured = env.ZENOD_CHANNELS_URL?.trim();
  const allowed = (env.ZENOD_CHANNELS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!configured || allowed.length === 0) return null;
  try {
    const parsed = new URL(configured);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname && parsed.pathname !== "/")
    )
      return null;
    const allowedOrigins = allowed.map((value) => new URL(value).origin);
    return allowedOrigins.includes(parsed.origin) ? parsed.origin : null;
  } catch {
    return null;
  }
}
export function hostedChannelsConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    configuredPrivateOrigin(env) && env.ZENOD_CHANNELS_PRIVATE_TOKEN?.trim(),
  );
}
function memoryDownstreamUrl(env: NodeJS.ProcessEnv): string {
  return (
    env.ZENOD_CHANNELS_MEMORY_URL?.trim() ||
    `${(env.CUSTOMER_APP_URL || env.DOMAIN || "https://cloud.zenod.dev").replace(/\/$/, "")}/mcp`
  );
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === "string" ? value : undefined;
}
function nullableNumber(value: unknown): number | null | undefined {
  return value === null
    ? null
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
}
function projectChannels(value: unknown): HostedChannelsView | null {
  const root = record(value);
  const whatsapp = record(root?.whatsapp);
  const telegram = record(root?.telegram);
  if (!root || !whatsapp || !telegram) return null;
  if (
    !["off", "awaiting_code", "verified", "degraded", "paused"].includes(
      String(whatsapp.state),
    ) ||
    !["off", "awaiting_code", "connected", "degraded"].includes(
      String(telegram.state),
    )
  )
    return null;
  const senderHint = nullableString(whatsapp.senderHint);
  const sharedNumber = nullableString(whatsapp.sharedNumber);
  const verificationExpiresAt = nullableNumber(whatsapp.verificationExpiresAt);
  const lastInboundAt = nullableNumber(whatsapp.lastInboundAt);
  const lastReceiptAt = nullableNumber(whatsapp.lastReceiptAt);
  const whatsappRevision = nullableString(whatsapp.revision);
  const identityHint = nullableString(telegram.identityHint);
  const telegramVerificationExpiresAt = nullableNumber(
    telegram.verificationExpiresAt,
  );
  const telegramRevision = nullableString(telegram.revision);
  if (
    senderHint === undefined ||
    sharedNumber === undefined ||
    verificationExpiresAt === undefined ||
    lastInboundAt === undefined ||
    lastReceiptAt === undefined ||
    whatsappRevision === undefined ||
    identityHint === undefined ||
    telegramVerificationExpiresAt === undefined ||
    telegramRevision === undefined
  )
    return null;
  if (
    (senderHint !== null && !/^••••\d{1,8}$/.test(senderHint)) ||
    (sharedNumber !== null &&
      !/^\+?[\d ()-]{8,32}$/.test(sharedNumber) &&
      !/^••••\d{1,8}$/.test(sharedNumber)) ||
    (identityHint !== null && !/^@[-a-zA-Z0-9_]{1,64}$/.test(identityHint)) ||
    !whatsappRevision ||
    !/^[a-zA-Z0-9._:-]{1,160}$/.test(whatsappRevision) ||
    !telegramRevision ||
    !/^[a-zA-Z0-9._:-]{1,160}$/.test(telegramRevision)
  )
    return null;
  return {
    whatsapp: {
      state: whatsapp.state as HostedWhatsAppState,
      senderHint: senderHint!,
      sharedNumber: sharedNumber!,
      verificationExpiresAt: verificationExpiresAt!,
      lastInboundAt: lastInboundAt!,
      lastReceiptAt: lastReceiptAt!,
      revision: whatsappRevision,
    },
    telegram: {
      state: telegram.state as HostedTelegramState,
      identityHint: identityHint!,
      verificationExpiresAt: telegramVerificationExpiresAt!,
      revision: telegramRevision,
    },
  };
}
function projectMutation(
  value: unknown,
  expected: HostedChannelMutationName,
  expectedId?: string,
): HostedChannelMutationOutcome | null {
  const item = record(value);
  if (
    !item ||
    item.operation !== expected ||
    !safeOperationId(item.operationId) ||
    (expectedId !== undefined && item.operationId !== expectedId) ||
    !["succeeded", "rejected", "failed"].includes(String(item.outcome)) ||
    typeof item.at !== "number" ||
    !Number.isFinite(item.at)
  )
    return null;
  return {
    operationId: item.operationId as string,
    operation: expected,
    outcome: item.outcome as HostedChannelMutationOutcome["outcome"],
    at: item.at,
  };
}
function publicErrorMessage(
  code: HostedChannelErrorResponse["error"]["code"],
): string {
  switch (code) {
    case "invalid_request":
      return "Check the channel details and try again.";
    case "sender_in_use":
      return "That sender is already connected to another Zenod account.";
    case "identity_in_use":
      return "That Telegram identity is already connected to another Zenod account.";
    case "already_connected":
      return "Disconnect the current binding before connecting another one.";
    case "not_connected":
      return "Connect this channel before using that action.";
    case "operation_conflict":
      return "This request key was already used for a different action.";
    case "operation_in_progress":
      return "This channel action is still in progress. Retry with the same request key.";
    case "channels_unavailable":
      return "Channels are temporarily unavailable. Try again shortly.";
  }
}
function projectError(
  value: unknown,
  expected?: HostedChannelMutationName,
  expectedId?: string,
): HostedChannelErrorResponse | null {
  const root = record(value);
  const error = record(root?.error);
  const codes = [
    "invalid_request",
    "sender_in_use",
    "identity_in_use",
    "already_connected",
    "not_connected",
    "operation_conflict",
    "operation_in_progress",
    "channels_unavailable",
  ];
  if (
    !root ||
    !error ||
    !codes.includes(String(error.code)) ||
    typeof error.message !== "string"
  )
    return null;
  const code = error.code as HostedChannelErrorResponse["error"]["code"];
  const retryDisposition =
    error.retryDisposition === "retry_same_operation" ||
    error.retryDisposition === "retry_new_operation"
      ? error.retryDisposition
      : code === "operation_in_progress"
        ? "retry_same_operation"
        : "retry_new_operation";
  const mutation =
    expected && root.mutation
      ? projectMutation(root.mutation, expected, expectedId)
      : null;
  if (expected && !mutation) return null;
  return {
    error: { code, message: publicErrorMessage(code), retryDisposition },
    ...(mutation ? { mutation } : {}),
  };
}
function projectAction(
  value: unknown,
  operation: HostedChannelMutationName,
  expectedId: string,
): unknown | null {
  const root = record(value);
  const channels = projectChannels(root?.channels);
  const mutation = projectMutation(root?.mutation, operation, expectedId);
  if (!root || !channels || !mutation) return null;
  if (operation === "whatsapp.challenge") {
    const challenge = record(root.challenge);
    if (
      !challenge ||
      typeof challenge.code !== "string" ||
      !/^\d{2}-[a-z]{2,24}$/.test(challenge.code) ||
      typeof challenge.sharedNumber !== "string" ||
      !/^\+?[\d ()-]{8,32}$/.test(challenge.sharedNumber) ||
      typeof challenge.expiresAt !== "number" ||
      !Number.isFinite(challenge.expiresAt)
    )
      return null;
    return {
      channels,
      challenge: {
        code: challenge.code,
        sharedNumber: challenge.sharedNumber,
        expiresAt: challenge.expiresAt,
      },
      mutation,
    } satisfies HostedChannelChallengeResponse;
  }
  if (operation === "telegram.connect") {
    const challenge = record(root.challenge);
    if (
      !challenge ||
      typeof challenge.code !== "string" ||
      !/^\d{2}-[a-z]{2,24}$/.test(challenge.code) ||
      typeof challenge.expiresAt !== "number" ||
      !Number.isFinite(challenge.expiresAt)
    )
      return null;
    return {
      channels,
      challenge: {
        code: challenge.code,
        expiresAt: challenge.expiresAt,
      },
      mutation,
    } satisfies HostedChannelConnectResponse;
  }
  if (operation.endsWith(".test")) {
    const receipt = record(root.receipt);
    if (
      !receipt ||
      typeof receipt.deliveredAt !== "number" ||
      !Number.isFinite(receipt.deliveredAt)
    )
      return null;
    return {
      channels,
      receipt: { deliveredAt: receipt.deliveredAt },
      mutation,
    } satisfies HostedChannelTestResponse;
  }
  return { channels, mutation } satisfies HostedChannelConnectResponse;
}

function applyProcessingPause(value: unknown, paused: boolean): unknown {
  if (!paused || !value || typeof value !== "object") return value;
  const root = value as Record<string, unknown>;
  const channels =
    "channels" in root ? projectChannels(root.channels) : projectChannels(root);
  if (
    !channels ||
    !["verified", "degraded", "paused"].includes(channels.whatsapp.state)
  )
    return value;
  const nextChannels: HostedChannelsView = {
    ...channels,
    whatsapp: { ...channels.whatsapp, state: "paused" },
  };
  return "channels" in root
    ? { ...root, channels: nextChannels }
    : nextChannels;
}

async function proxyChannels(
  env: NodeJS.ProcessEnv,
  tenant: HostedChannelCustomerTenant,
  path: string,
  input?: {
    operation?: HostedChannelMutationName;
    body: Record<string, unknown>;
    includeCredentials?: boolean;
  },
): Promise<{ status: number; body: unknown }> {
  const base = configuredPrivateOrigin(env);
  const token = env.ZENOD_CHANNELS_PRIVATE_TOKEN?.trim();
  const unavailableMutation =
    input?.operation && typeof input.body.operationId === "string"
      ? {
          operationId: input.body.operationId,
          operation: input.operation,
          outcome: "failed" as const,
          at: Date.now(),
        }
      : null;
  const unavailable = {
    status: 503,
    body: {
      error: {
        code: "channels_unavailable",
        message: "Channels are temporarily unavailable. Try again shortly.",
        retryDisposition: "retry_same_operation",
      },
      ...(unavailableMutation ? { mutation: unavailableMutation } : {}),
    } satisfies HostedChannelErrorResponse,
  };
  if (!base || !token) return unavailable;
  try {
    const response = await fetch(
      `${base}/internal/zenod/channels/${encodeURIComponent(tenant.tenantId)}${path}`,
      {
        method: input ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(input ? { "content-type": "application/json" } : {}),
        },
        ...(input
          ? {
              body: JSON.stringify({
                ...input.body,
                ...(input.includeCredentials
                  ? {
                      downstreamUrl: memoryDownstreamUrl(env),
                      downstreamToken: tenant.downstreamToken,
                    }
                  : {}),
              }),
            }
          : {}),
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      },
    );
    const raw = await response.json().catch(() => null);
    if (!response.ok) {
      const expectedId =
        typeof input?.body.operationId === "string"
          ? input.body.operationId
          : undefined;
      const error = projectError(raw, input?.operation, expectedId);
      return error ? { status: response.status, body: error } : unavailable;
    }
    const expectedId =
      typeof input?.body.operationId === "string" ? input.body.operationId : "";
    const projected = input?.operation
      ? projectAction(raw, input.operation, expectedId)
      : projectChannels(raw);
    return projected
      ? {
          status: response.status,
          body: applyProcessingPause(
            projected,
            tenant.processingPaused === true,
          ),
        }
      : unavailable;
  } catch {
    return unavailable;
  }
}

export function mountHostedChannelsCustomerRoutes(
  app: Hono<{ Bindings: HttpBindings }>,
  input: {
    env: NodeJS.ProcessEnv;
    routeVisible?: (
      c: Context<{ Bindings: HttpBindings }>,
    ) => boolean | Promise<boolean>;
    resolveTenant: (
      c: Context<{ Bindings: HttpBindings }>,
    ) =>
      | HostedChannelCustomerTenant
      | null
      | Promise<HostedChannelCustomerTenant | null>;
  },
): void {
  app.get("/api/channels", async (c) => {
    if (input.routeVisible && !(await input.routeVisible(c))) {
      return c.json({ error: "not found" }, 404);
    }
    const tenant = await input.resolveTenant(c);
    if (!tenant) return c.json({ error: "unauthorized" }, 401);
    const response = await proxyChannels(input.env, tenant, "");
    return c.json(response.body, response.status as ContentfulStatusCode);
  });
  const actions = [
    ["whatsapp", "challenge", "whatsapp.challenge", true],
    ["whatsapp", "test", "whatsapp.test", false],
    ["whatsapp", "disconnect", "whatsapp.disconnect", false],
    ["telegram", "connect", "telegram.connect", true],
    ["telegram", "test", "telegram.test", false],
    ["telegram", "disconnect", "telegram.disconnect", false],
  ] as const;
  for (const [channel, action, operation, includeCredentials] of actions) {
    app.post(`/api/channels/${channel}/${action}`, async (c) => {
      if (input.routeVisible && !(await input.routeVisible(c))) {
        return c.json({ error: "not found" }, 404);
      }
      const tenant = await input.resolveTenant(c);
      if (!tenant) return c.json({ error: "unauthorized" }, 401);
      const raw = await c.req
        .json<Record<string, unknown>>()
        .catch((): Record<string, unknown> => ({}));
      const operationId = safeOperationId(raw.operationId);
      if (!operationId)
        return c.json(
          {
            error: {
              code: "invalid_request",
              message: "A valid request key is required.",
            },
          },
          400,
        );
      const body: Record<string, unknown> = { operationId };
      if (operation === "whatsapp.challenge") body.sender = raw.sender;
      if (operation === "telegram.connect") body.identity = raw.identity;
      const response = await proxyChannels(
        input.env,
        tenant,
        `/${channel}/${action}`,
        { operation, body, includeCredentials },
      );
      return c.json(response.body, response.status as ContentfulStatusCode);
    });
  }
}
