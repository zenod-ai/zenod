import { createHmac } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { UnitContext } from "@zenod/mcp-chassis";
import { z } from "zod";
import {
  executeHostedChannelMutation,
  hostedChannelChallengeCode,
  hostedChannelView,
  normalizeHostedPhone,
  normalizeHostedTelegram,
  type HostedChannelMutationName,
  type HostedChannelMutationOutcome,
} from "./hostedChannels.js";
import {
  PhylaxAllowanceLedger,
  PhylaxLedgerConflictError,
} from "./phylaxAllowanceLedger.js";
import type { PhylaxPortedRuntime } from "./phylaxPortedRuntime.js";
import {
  type PhylaxCommercialOwner,
  type PhylaxTenantSettingsStore,
} from "./phylaxTenantSettings.js";
import type { HostedChannelMutationAuditStore } from "./hostedChannels.js";
import type { PhylaxUsageMeter } from "./phylaxUsageMeter.js";

export const PHYLAX_MANAGEMENT_PROTOCOL = "phylax.management";
export const PHYLAX_MANAGEMENT_VERSION = "1.0";

export const PHYLAX_MANAGEMENT_TOOL_NAMES = [
  "phylax_management_v1_capabilities",
  "phylax_management_v1_ensure_binding",
  "phylax_management_v1_channel_status",
  "phylax_management_v1_channel_connect",
  "phylax_management_v1_channel_test",
  "phylax_management_v1_channel_disconnect",
  "phylax_management_v1_credit_grant",
  "phylax_management_v1_credit_adjust",
  "phylax_management_v1_credit_query",
  "phylax_management_v1_suspend",
  "phylax_management_v1_resume",
] as const;

export const PHYLAX_MANAGEMENT_PROFILES = {
  zenod: "phylax-management-v1-zenod",
  pm: "phylax-management-v1-pm",
  phylax: "phylax-management-v1-phylax",
} as const satisfies Record<PhylaxCommercialOwner, string>;

const OWNER_BY_PROFILE = Object.fromEntries(
  Object.entries(PHYLAX_MANAGEMENT_PROFILES).map(([owner, profile]) => [profile, owner]),
) as Record<string, PhylaxCommercialOwner>;

function managementAuthorityScope(owner: PhylaxCommercialOwner): string {
  return `management:${owner}`;
}

export function phylaxManagementConnectOperationProof(input: {
  secret: string;
  tenantId: string;
  owner: PhylaxCommercialOwner;
  channel: "whatsapp" | "telegram";
  operationId: string;
  identity: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(JSON.stringify([
      "phylax-management-connect-attribution-v1",
      input.tenantId,
      input.owner,
      input.channel,
      input.operationId,
      input.identity,
    ]), "utf8")
    .digest("base64url");
}

const operationId = z.string().trim().regex(/^[a-zA-Z0-9._:-]{8,160}$/);
const revision = z.string().trim().regex(/^[a-zA-Z0-9._:-]{1,160}$/);
const tenantReference = z.string().trim().regex(/^[a-zA-Z0-9._:-]{1,160}$/);

interface ManagementDependencies {
  settings: PhylaxTenantSettingsStore;
  runtime: PhylaxPortedRuntime;
  audit: HostedChannelMutationAuditStore;
  ledger: PhylaxAllowanceLedger;
  usageMeter: PhylaxUsageMeter;
  challengeSecret: string;
}

function result(value: unknown, text = "Phylax management request completed.") {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: value as Record<string, unknown>,
  };
}

function errorResult(code: string, message: string, details: Record<string, unknown> = {}) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
    structuredContent: { error: { code, message }, ...details },
  };
}

function mutationFailure(
  operationIdValue: string,
  operation: HostedChannelMutationName,
  code: string,
  message: string,
): { status: number; body: unknown } {
  return {
    status: code === "stale_revision" || code.endsWith("_conflict") ? 409 : 400,
    body: {
      error: { code, message },
      mutation: {
        operationId: operationIdValue,
        operation,
        outcome: "rejected",
        at: Date.now(),
      } satisfies HostedChannelMutationOutcome,
    },
  };
}

function mutationToolResult(response: { status: number; body: unknown }) {
  const body = response.body && typeof response.body === "object"
    ? response.body as Record<string, unknown>
    : { error: { code: "management_failed", message: "Management request failed." } };
  const error = body.error && typeof body.error === "object"
    ? body.error as Record<string, unknown>
    : null;
  if (response.status < 400) {
    const mutation = body.mutation && typeof body.mutation === "object"
      ? body.mutation as Record<string, unknown>
      : null;
    const operationIdValue = typeof mutation?.operationId === "string"
      ? mutation.operationId
      : "management-mutation";
    return result({
      ...body,
      evidence: [{
        kind: "phylax_management_mutation",
        id: operationIdValue,
        status: "succeeded",
      }],
    });
  }
  return errorResult(
    typeof error?.code === "string" ? error.code : "management_failed",
    typeof error?.message === "string" ? error.message : "Management request failed.",
    body,
  );
}

function assertBound(
  settings: PhylaxTenantSettingsStore,
  tenantId: string,
  owner: PhylaxCommercialOwner,
) {
  const current = settings.get(tenantId);
  if (!current.commercialOwner || !current.externalTenantId) {
    throw new Error("management binding is not configured");
  }
  if (current.commercialOwner !== owner) {
    throw new Error("management credential owner does not match tenant binding");
  }
  return current;
}

function safeBinding(settings: PhylaxTenantSettingsStore, tenantId: string) {
  const current = settings.get(tenantId);
  return {
    commercialOwner: current.commercialOwner,
    externalTenantId: current.externalTenantId,
    revision: current.managementBindingRevision,
    downstreamConfigured: Boolean(settings.downstreamCredentials(tenantId)),
  };
}

function registerReadTools(
  server: McpServer,
  context: UnitContext,
  owner: PhylaxCommercialOwner,
  dependencies: ManagementDependencies,
) {
  const tenantId = context.tenant!.id;
  server.registerTool(
    "phylax_management_v1_capabilities",
    {
      description: "Negotiate the stable tenant-safe Phylax management MCP contract.",
      inputSchema: {
        clientVersions: z.array(z.string().trim().min(1).max(32)).max(16).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ clientVersions }) => {
      if (clientVersions && !clientVersions.includes(PHYLAX_MANAGEMENT_VERSION)) {
        return errorResult("unsupported_version", "No mutually supported Phylax management version.", {
          protocol: PHYLAX_MANAGEMENT_PROTOCOL,
          supportedVersions: [PHYLAX_MANAGEMENT_VERSION],
        });
      }
      return result({
        protocol: PHYLAX_MANAGEMENT_PROTOCOL,
        selectedVersion: PHYLAX_MANAGEMENT_VERSION,
        supportedVersions: [PHYLAX_MANAGEMENT_VERSION],
        owner,
        tenantScoped: true,
        ownerAdminSurface: false,
        capturePolicy: { archiveRawAudio: "always", maxTranscriptionSeconds: 7_200 },
        tools: [...PHYLAX_MANAGEMENT_TOOL_NAMES],
      });
    },
  );

  server.registerTool(
    "phylax_management_v1_channel_status",
    {
      description: "Read channel state for only the authenticated Phylax tenant.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        assertBound(dependencies.settings, tenantId, owner);
        return result({
          binding: safeBinding(dependencies.settings, tenantId),
          channels: hostedChannelView(tenantId, dependencies.settings, dependencies.runtime),
        });
      } catch (error) {
        return errorResult("binding_required", error instanceof Error ? error.message : "Binding is unavailable.");
      }
    },
  );

  server.registerTool(
    "phylax_management_v1_credit_query",
    {
      description: "Read the customer-safe allowance projection for only the authenticated tenant.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        assertBound(dependencies.settings, tenantId, owner);
        return result({
          revision: dependencies.ledger.revision(tenantId),
          allowance: dependencies.ledger.customerProjection(tenantId),
        });
      } catch (error) {
        return errorResult("binding_required", error instanceof Error ? error.message : "Binding is unavailable.");
      }
    },
  );
}

function registerEnsureTool(
  server: McpServer,
  tenantId: string,
  owner: PhylaxCommercialOwner,
  dependencies: ManagementDependencies,
) {
  server.registerTool(
    "phylax_management_v1_ensure_binding",
    {
      description: "Idempotently bind this authenticated Phylax tenant to its host tenant and downstream MCP.",
      inputSchema: {
        operationId,
        expectedRevision: revision,
        externalTenantId: tenantReference,
        downstreamUrl: z.string().url().max(4_096),
        downstreamToken: z.string().trim().min(1).max(8_192),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const operation = "management.ensure_binding" as const;
      const response = await executeHostedChannelMutation(
        dependencies.audit,
        {
          operationId: input.operationId,
          tenantId,
          authorityScope: managementAuthorityScope(owner),
          operation,
          requestBody: { ...input },
          target: `${owner}:${input.externalTenantId}`,
          bindingRevision: () => dependencies.settings.get(tenantId).managementBindingRevision,
          recoverOrphaned: () => {
            const current = dependencies.settings.get(tenantId);
            if (current.managementBindingRevision === input.expectedRevision) {
              return { state: "not_applied" as const };
            }
            const credentials = dependencies.settings.downstreamCredentials(tenantId);
            if (
              current.commercialOwner !== owner ||
              current.externalTenantId !== input.externalTenantId ||
              credentials?.url !== new URL(input.downstreamUrl.trim()).toString() ||
              credentials.token !== input.downstreamToken.trim()
            ) {
              return { state: "unknown" as const };
            }
            const at = Date.now();
            return {
              state: "applied" as const,
              result: {
                status: 200,
                body: {
                  binding: safeBinding(dependencies.settings, tenantId),
                  replayed: true,
                  mutation: {
                    operationId: input.operationId,
                    operation,
                    outcome: "succeeded",
                    at,
                  } satisfies HostedChannelMutationOutcome,
                },
              },
            };
          },
        },
        () => {
          try {
            const ensured = dependencies.settings.ensureManagementBinding({
              tenantId,
              commercialOwner: owner,
              externalTenantId: input.externalTenantId,
              downstreamUrl: input.downstreamUrl,
              downstreamToken: input.downstreamToken,
              expectedRevision: input.expectedRevision,
            });
            return {
              status: 200,
              body: {
                binding: safeBinding(dependencies.settings, tenantId),
                replayed: ensured.replayed,
                mutation: {
                  operationId: input.operationId,
                  operation,
                  outcome: "succeeded",
                  at: Date.now(),
                } satisfies HostedChannelMutationOutcome,
              },
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Binding failed.";
            const code = /revision/.test(message) ? "stale_revision"
              : /owner|tenant is already bound/.test(message) ? "binding_conflict"
              : "invalid_request";
            return mutationFailure(input.operationId, operation, code, message);
          }
        },
      );
      return mutationToolResult(response);
    },
  );
}

function registerChannelMutationTools(
  server: McpServer,
  tenantId: string,
  owner: PhylaxCommercialOwner,
  dependencies: ManagementDependencies,
) {
  server.registerTool(
    "phylax_management_v1_channel_connect",
    {
      description: "Create a tenant-scoped WhatsApp or Telegram verification challenge.",
      inputSchema: {
        operationId,
        expectedRevision: revision,
        channel: z.enum(["whatsapp", "telegram"]),
        identity: z.string().trim().min(1).max(160),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        assertBound(dependencies.settings, tenantId, owner);
      } catch (error) {
        return errorResult("binding_required", error instanceof Error ? error.message : "Binding is unavailable.");
      }
      const operation = (input.channel === "whatsapp" ? "whatsapp.challenge" : "telegram.connect") as HostedChannelMutationName;
      const identity = input.channel === "whatsapp"
        ? normalizeHostedPhone(input.identity)
        : normalizeHostedTelegram(input.identity);
      if (!identity) return errorResult("invalid_request", "Channel identity is invalid.");
      const code = hostedChannelChallengeCode(
        dependencies.challengeSecret,
        tenantId,
        input.operationId,
        identity,
      );
      const operationProof = phylaxManagementConnectOperationProof({
        secret: dependencies.challengeSecret,
        tenantId,
        owner,
        channel: input.channel,
        operationId: input.operationId,
        identity,
      });
      const response = await executeHostedChannelMutation(
        dependencies.audit,
        {
          operationId: input.operationId,
          tenantId,
          authorityScope: managementAuthorityScope(owner),
          operation,
          requestBody: { channel: input.channel, identity, expectedRevision: input.expectedRevision },
          target: identity,
          bindingRevision: () => dependencies.settings.bindingRevision(tenantId, input.channel),
          deriveChallenge: () => code,
          recoverOrphaned: () => {
            const current = dependencies.settings.get(tenantId);
            const currentRevision = dependencies.settings.bindingRevision(tenantId, input.channel);
            if (currentRevision === input.expectedRevision) {
              return { state: "not_applied" as const };
            }
            const at = Date.now();
            const applied = dependencies.settings.matchesPendingManagementOperationProof({
              tenantId,
              channel: input.channel,
              identity,
              operationProof,
              now: at,
            });
            const sharedNumber = input.channel === "whatsapp"
              ? dependencies.runtime.whatsapp.status().linkedNumber
              : null;
            if (!applied || (input.channel === "whatsapp" && !sharedNumber)) {
              return { state: "unknown" as const };
            }
            return {
              state: "applied" as const,
              result: {
                status: 200,
                body: {
                  channels: hostedChannelView(tenantId, dependencies.settings, dependencies.runtime, at),
                  challenge: {
                    code,
                    ...(sharedNumber ? { sharedNumber } : {}),
                    expiresAt: input.channel === "whatsapp"
                      ? current.verificationExpiresAt!
                      : current.telegramVerificationExpiresAt!,
                  },
                  mutation: {
                    operationId: input.operationId,
                    operation,
                    outcome: "succeeded",
                    at,
                  } satisfies HostedChannelMutationOutcome,
                },
              },
            };
          },
        },
        () => {
          const currentRevision = dependencies.settings.bindingRevision(tenantId, input.channel);
          if (currentRevision !== input.expectedRevision) {
            return mutationFailure(input.operationId, operation, "stale_revision", "Channel binding revision is stale.");
          }
          const at = Date.now();
          try {
            if (input.channel === "whatsapp") {
              const current = dependencies.settings.get(tenantId);
              if (current.verified && current.phoneNumber) {
                return mutationFailure(input.operationId, operation, "binding_conflict", "Disconnect the current sender first.");
              }
              dependencies.settings.assertPhoneAvailable(tenantId, identity);
              const sharedNumber = dependencies.runtime.whatsapp.status().linkedNumber;
              if (!sharedNumber) return mutationFailure(input.operationId, operation, "channels_unavailable", "WhatsApp transport is unavailable.");
              const registration = dependencies.settings.registerPhone(
                tenantId,
                identity,
                "primary",
                at,
                code,
                operationProof,
              );
              return {
                status: 200,
                body: {
                  channels: hostedChannelView(tenantId, dependencies.settings, dependencies.runtime, at),
                  challenge: { code, sharedNumber, expiresAt: registration.settings.verificationExpiresAt ?? at },
                  mutation: { operationId: input.operationId, operation, outcome: "succeeded", at },
                },
              };
            }
            const current = dependencies.settings.get(tenantId);
            if (current.telegramBinding) {
              return mutationFailure(input.operationId, operation, "binding_conflict", "Disconnect the current Telegram identity first.");
            }
            dependencies.settings.assertTelegramAvailable(tenantId, identity);
            const registration = dependencies.settings.registerTelegram(
              tenantId,
              identity,
              at,
              code,
              operationProof,
            );
            return {
              status: 200,
              body: {
                channels: hostedChannelView(tenantId, dependencies.settings, dependencies.runtime, at),
                challenge: { code, expiresAt: registration.settings.telegramVerificationExpiresAt ?? at },
                mutation: { operationId: input.operationId, operation, outcome: "succeeded", at },
              },
            };
          } catch (error) {
            return mutationFailure(
              input.operationId,
              operation,
              "binding_conflict",
              error instanceof Error ? error.message : "Channel binding failed.",
            );
          }
        },
      );
      return mutationToolResult(response);
    },
  );

  server.registerTool(
    "phylax_management_v1_channel_test",
    {
      description: "Send one explicit tenant-scoped channel test message.",
      inputSchema: { operationId, expectedRevision: revision, channel: z.enum(["whatsapp", "telegram"]) },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        assertBound(dependencies.settings, tenantId, owner);
      } catch (error) {
        return errorResult("binding_required", error instanceof Error ? error.message : "Binding is unavailable.");
      }
      const operation = `${input.channel}.test` as HostedChannelMutationName;
      const response = await executeHostedChannelMutation(
        dependencies.audit,
        {
          operationId: input.operationId,
          tenantId,
          authorityScope: managementAuthorityScope(owner),
          operation,
          requestBody: { channel: input.channel, expectedRevision: input.expectedRevision },
          target: input.channel === "whatsapp"
            ? dependencies.settings.get(tenantId).phoneNumber
            : dependencies.settings.get(tenantId).telegramBinding,
          bindingRevision: () => dependencies.settings.bindingRevision(tenantId, input.channel),
        },
        async () => {
          if (dependencies.settings.bindingRevision(tenantId, input.channel) !== input.expectedRevision) {
            return mutationFailure(input.operationId, operation, "stale_revision", "Channel binding revision is stale.");
          }
          const at = Date.now();
          const settings = dependencies.settings.get(tenantId);
          const recipient = input.channel === "whatsapp"
            ? settings.verified ? settings.phoneNumber : null
            : settings.telegramBinding;
          if (!recipient) return mutationFailure(input.operationId, operation, "not_connected", "Channel is not connected.");
          try {
            const receipt = await dependencies.runtime.delivery(tenantId).send(
              input.channel,
              recipient,
              "Phylax channel test: this identity is connected.",
            );
            return {
              status: 200,
              body: {
                channels: hostedChannelView(tenantId, dependencies.settings, dependencies.runtime, at),
                receipt,
                mutation: { operationId: input.operationId, operation, outcome: "succeeded", at },
              },
            };
          } catch {
            return mutationFailure(input.operationId, operation, "channels_unavailable", "Channel test delivery failed.");
          }
        },
      );
      return mutationToolResult(response);
    },
  );

  server.registerTool(
    "phylax_management_v1_channel_disconnect",
    {
      description: "Disconnect only this authenticated tenant's channel binding.",
      inputSchema: { operationId, expectedRevision: revision, channel: z.enum(["whatsapp", "telegram"]) },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        assertBound(dependencies.settings, tenantId, owner);
      } catch (error) {
        return errorResult("binding_required", error instanceof Error ? error.message : "Binding is unavailable.");
      }
      const operation = `${input.channel}.disconnect` as HostedChannelMutationName;
      const response = await executeHostedChannelMutation(
        dependencies.audit,
        {
          operationId: input.operationId,
          tenantId,
          authorityScope: managementAuthorityScope(owner),
          operation,
          requestBody: { channel: input.channel, expectedRevision: input.expectedRevision },
          // The effect clears the live binding. Keep the audit target derived
          // entirely from the request so crash-after-effect recovery hashes
          // the same target before and after disconnect.
          target: `disconnect:${input.channel}:${input.expectedRevision}`,
          bindingRevision: () => dependencies.settings.bindingRevision(tenantId, input.channel),
          recoverOrphaned: () => {
            const current = dependencies.settings.get(tenantId);
            const currentRevision = dependencies.settings.bindingRevision(tenantId, input.channel);
            if (currentRevision === input.expectedRevision) {
              return { state: "not_applied" as const };
            }
            const disconnected = input.channel === "whatsapp"
              ? current.phoneNumber === null && !current.verified
              : current.telegramBinding === null && current.telegramPendingIdentity === null;
            if (!disconnected) return { state: "unknown" as const };
            const at = Date.now();
            return {
              state: "applied" as const,
              result: {
                status: 200,
                body: {
                  channels: hostedChannelView(tenantId, dependencies.settings, dependencies.runtime, at),
                  mutation: {
                    operationId: input.operationId,
                    operation,
                    outcome: "succeeded",
                    at,
                  } satisfies HostedChannelMutationOutcome,
                },
              },
            };
          },
        },
        () => {
          if (dependencies.settings.bindingRevision(tenantId, input.channel) !== input.expectedRevision) {
            return mutationFailure(input.operationId, operation, "stale_revision", "Channel binding revision is stale.");
          }
          const at = Date.now();
          if (input.channel === "whatsapp") dependencies.settings.disconnectPhone(tenantId, at);
          else dependencies.settings.disconnectTelegram(tenantId);
          return {
            status: 200,
            body: {
              channels: hostedChannelView(tenantId, dependencies.settings, dependencies.runtime, at),
              mutation: { operationId: input.operationId, operation, outcome: "succeeded", at },
            },
          };
        },
      );
      return mutationToolResult(response);
    },
  );
}

function registerLedgerMutationTool(
  server: McpServer,
  tenantId: string,
  owner: PhylaxCommercialOwner,
  dependencies: ManagementDependencies,
  input: {
    tool: "phylax_management_v1_credit_grant" | "phylax_management_v1_credit_adjust";
    operation: "management.credit_grant" | "management.credit_adjust";
    amount: z.ZodNumber;
  },
) {
  server.registerTool(
    input.tool,
    {
      description: input.operation === "management.credit_grant"
        ? "Append an issuer-neutral allowance grant for this authenticated tenant."
        : "Append an issuer-neutral signed allowance adjustment for this authenticated tenant.",
      inputSchema: {
        operationId,
        expectedRevision: revision,
        periodId: z.string().trim().min(1).max(256),
        amountUnits: input.amount,
        ...(input.operation === "management.credit_grant"
          ? {
              startsAt: z.number().int().nonnegative(),
              endsAt: z.number().int().positive(),
            }
          : {}),
        tariffVersion: z.string().trim().min(1).max(128),
        auditReason: z.string().trim().min(1).max(2_000),
      },
      annotations: { destructiveHint: input.operation === "management.credit_adjust", idempotentHint: true, openWorldHint: false },
    },
    async (args: {
      operationId: string;
      expectedRevision: string;
      periodId: string;
      amountUnits: number;
      startsAt?: number;
      endsAt?: number;
      tariffVersion: string;
      auditReason: string;
    }) => {
      try {
        assertBound(dependencies.settings, tenantId, owner);
      } catch (error) {
        return errorResult("binding_required", error instanceof Error ? error.message : "Binding is unavailable.");
      }
      const operation = input.operation;
      const response = await executeHostedChannelMutation(
        dependencies.audit,
        {
          operationId: args.operationId,
          tenantId,
          authorityScope: managementAuthorityScope(owner),
          operation,
          requestBody: { ...args },
          target: args.periodId,
          // The caller's expected revision is part of this operation identity.
          // Later usage/reconciliation entries must not turn an exact retry of
          // an already-terminal mutation into an operation-key conflict.
          bindingRevision: () => args.expectedRevision,
          recoverOrphaned: () => {
            const existing = dependencies.ledger
              .operatorProjection(tenantId, args.periodId)
              .entries.find((entry) => entry.idempotencyKey === args.operationId);
            if (!existing) {
              return dependencies.ledger.revision(tenantId) === args.expectedRevision
                ? { state: "not_applied" as const }
                : { state: "unknown" as const };
            }
            if (
              existing.kind !== (input.operation === "management.credit_grant" ? "grant" : "adjustment") ||
              existing.amountUnits !== args.amountUnits ||
              existing.source !== `commercial-owner:${owner}`
            ) {
              return { state: "unknown" as const };
            }
            return {
              state: "applied" as const,
              result: {
                status: 200,
                body: {
                  revision: dependencies.ledger.revision(tenantId),
                  replayed: true,
                  allowance: dependencies.ledger.customerProjection(tenantId),
                  mutation: {
                    operationId: args.operationId,
                    operation,
                    outcome: "succeeded",
                    at: existing.occurredAt,
                  } satisfies HostedChannelMutationOutcome,
                },
              },
            };
          },
        },
        () => {
          if (dependencies.ledger.revision(tenantId) !== args.expectedRevision) {
            return mutationFailure(args.operationId, operation, "stale_revision", "Allowance revision is stale.");
          }
          try {
            const source = `commercial-owner:${owner}`;
            const mutation = input.operation === "management.credit_grant"
              ? dependencies.ledger.grantAllowance({
                  tenantId,
                  periodId: args.periodId,
                  startsAt: args.startsAt!,
                  endsAt: args.endsAt!,
                  amountUnits: args.amountUnits,
                  source,
                  idempotencyKey: args.operationId,
                  tariffVersion: args.tariffVersion,
                  auditReason: args.auditReason,
                })
              : dependencies.ledger.adjustAllowance({
                  tenantId,
                  periodId: args.periodId,
                  amountUnits: args.amountUnits,
                  source,
                  idempotencyKey: args.operationId,
                  tariffVersion: args.tariffVersion,
                  auditReason: args.auditReason,
                });
            dependencies.usageMeter.reconcilePending(tenantId);
            dependencies.ledger.resumePaused(tenantId);
            return {
              status: 200,
              body: {
                revision: dependencies.ledger.revision(tenantId),
                replayed: mutation.replayed,
                allowance: dependencies.ledger.customerProjection(tenantId),
                mutation: { operationId: args.operationId, operation, outcome: "succeeded", at: Date.now() },
              },
            };
          } catch (error) {
            const conflict = error instanceof PhylaxLedgerConflictError;
            return mutationFailure(
              args.operationId,
              operation,
              conflict ? "ledger_conflict" : "invalid_request",
              error instanceof Error ? error.message : "Allowance mutation failed.",
            );
          }
        },
      );
      if (response.status < 400) {
        dependencies.runtime.wakeAllowanceWork();
      }
      return mutationToolResult(response);
    },
  );
}

function registerControlTool(
  server: McpServer,
  tenantId: string,
  owner: PhylaxCommercialOwner,
  dependencies: ManagementDependencies,
  kind: "suspend" | "resume",
) {
  const tool = `phylax_management_v1_${kind}` as const;
  const operation = `management.${kind}` as "management.suspend" | "management.resume";
  server.registerTool(
    tool,
    {
      description: `${kind === "suspend" ? "Suspend" : "Resume"} paid processing for only the authenticated tenant without deleting custody or channel bindings.`,
      inputSchema: {
        operationId,
        expectedRevision: revision,
        auditReason: z.string().trim().min(1).max(2_000),
      },
      annotations: { destructiveHint: kind === "suspend", idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        assertBound(dependencies.settings, tenantId, owner);
      } catch (error) {
        return errorResult("binding_required", error instanceof Error ? error.message : "Binding is unavailable.");
      }
      const response = await executeHostedChannelMutation(
        dependencies.audit,
        {
          operationId: args.operationId,
          tenantId,
          authorityScope: managementAuthorityScope(owner),
          operation,
          requestBody: { ...args },
          target: tenantId,
          bindingRevision: () => args.expectedRevision,
          recoverOrphaned: () => {
            const existing = dependencies.ledger
              .operatorProjection(tenantId)
              .entries.find((entry) => entry.idempotencyKey === args.operationId);
            if (!existing) {
              return dependencies.ledger.revision(tenantId) === args.expectedRevision
                ? { state: "not_applied" as const }
                : { state: "unknown" as const };
            }
            if (
              existing.kind !== kind ||
              existing.source !== `commercial-owner:${owner}`
            ) {
              return { state: "unknown" as const };
            }
            return {
              state: "applied" as const,
              result: {
                status: 200,
                body: {
                  revision: dependencies.ledger.revision(tenantId),
                  replayed: true,
                  allowance: dependencies.ledger.customerProjection(tenantId),
                  mutation: {
                    operationId: args.operationId,
                    operation,
                    outcome: "succeeded",
                    at: existing.occurredAt,
                  } satisfies HostedChannelMutationOutcome,
                },
              },
            };
          },
        },
        () => {
          if (dependencies.ledger.revision(tenantId) !== args.expectedRevision) {
            return mutationFailure(args.operationId, operation, "stale_revision", "Allowance revision is stale.");
          }
          try {
            const mutation = dependencies.ledger[`${kind}Tenant`]({
              tenantId,
              source: `commercial-owner:${owner}`,
              idempotencyKey: args.operationId,
              auditReason: args.auditReason,
            });
            if (kind === "resume") {
              dependencies.usageMeter.reconcilePending(tenantId);
              dependencies.ledger.resumePaused(tenantId);
            }
            return {
              status: 200,
              body: {
                revision: dependencies.ledger.revision(tenantId),
                replayed: mutation.replayed,
                allowance: dependencies.ledger.customerProjection(tenantId),
                mutation: { operationId: args.operationId, operation, outcome: "succeeded", at: Date.now() },
              },
            };
          } catch (error) {
            return mutationFailure(
              args.operationId,
              operation,
              error instanceof PhylaxLedgerConflictError ? "ledger_conflict" : "invalid_request",
              error instanceof Error ? error.message : "Tenant control mutation failed.",
            );
          }
        },
      );
      if (response.status < 400 && kind === "resume") {
        dependencies.runtime.wakeAllowanceWork();
      }
      return mutationToolResult(response);
    },
  );
}

/** Register only for a backend service credential profile; ordinary tenant/OAuth credentials get no tools. */
export function registerPhylaxManagementTools(
  server: McpServer,
  context: UnitContext,
  dependencies: ManagementDependencies,
): void {
  const owner = context.credentialProfile
    ? OWNER_BY_PROFILE[context.credentialProfile]
    : undefined;
  if (!owner || !context.tenant) return;
  const tenantId = context.tenant.id;
  registerReadTools(server, context, owner, dependencies);
  registerEnsureTool(server, tenantId, owner, dependencies);
  registerChannelMutationTools(server, tenantId, owner, dependencies);
  registerLedgerMutationTool(server, tenantId, owner, dependencies, {
    tool: "phylax_management_v1_credit_grant",
    operation: "management.credit_grant",
    amount: z.number().int().positive(),
  });
  registerLedgerMutationTool(server, tenantId, owner, dependencies, {
    tool: "phylax_management_v1_credit_adjust",
    operation: "management.credit_adjust",
    amount: z.number().int().refine((value) => value !== 0, "amountUnits must not be zero"),
  });
  registerControlTool(server, tenantId, owner, dependencies, "suspend");
  registerControlTool(server, tenantId, owner, dependencies, "resume");
}
