import { beforeEach, describe, expect, it } from "vitest";
import {
  authorizeTurnPlanOperation,
  HOST_APPROVAL_REQUIRED_GUARD_SENTINEL,
  NOTHING_PENDING_TO_APPROVE_GUARD_SENTINEL,
  peerMutationGuardFailure,
  type TrustedConnectionProfile,
} from "../src/taskingPolicy.js";
import { __resetApprovalTokens } from "../src/approvalTokens.js";

const privateTenantProfile: TrustedConnectionProfile = {
  exposure: "private",
  tenantScope: "tenant",
  financialScope: "none",
  trustMcpAnnotations: true,
};

const safeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

function context(
  overrides: Partial<Parameters<typeof peerMutationGuardFailure>[2]> = {},
): NonNullable<Parameters<typeof peerMutationGuardFailure>[2]> {
  return {
    connectedMcp: true,
    conversationId: "tenant-a:ring:thread-1",
    owner: "connection-a",
    args: { content: "exact proposal" },
    annotations: safeAnnotations,
    trustedProfile: privateTenantProfile,
    ...overrides,
  };
}

describe("D9 model-proposes / host-authorizes contract", () => {
  beforeEach(() => __resetApprovalTokens());

  it("executes one typed private, tenant-scoped, non-destructive, closed-world proposal", () => {
    const operation = {
      toolId: "portable__operation__0123456789abcdef",
      input: { content: "exact proposal" },
      payloadRef: null,
    };
    expect(
      authorizeTurnPlanOperation({
        operation,
        annotations: safeAnnotations,
        profile: privateTenantProfile,
      }),
    ).toEqual({
      disposition: "execute",
      code: "private_tenant_safe",
      operation,
    });
  });

  it("does not use positive-intent prose or tool identity as authorization", () => {
    for (const tool of [
      "portable__store_memory__0123456789abcdef",
      "unrelated__future_operation__fedcba9876543210",
    ]) {
      expect(
        peerMutationGuardFailure(
          tool,
          "Please save and run this now.",
          context(),
        ),
      ).toBeNull();
      expect(
        peerMutationGuardFailure(
          tool,
          "Do not save, run, or call anything.",
          context(),
        ),
      ).toBeNull();
    }
  });

  it.each([
    ["public", { ...privateTenantProfile, exposure: "public" }],
    ["external", { ...privateTenantProfile, exposure: "external" }],
    ["cross-tenant", { ...privateTenantProfile, tenantScope: "cross_tenant" }],
    ["financial", { ...privateTenantProfile, financialScope: "financial" }],
    [
      "destructive",
      privateTenantProfile,
      { ...safeAnnotations, destructiveHint: true },
    ],
    [
      "open-world",
      privateTenantProfile,
      { ...safeAnnotations, openWorldHint: true },
    ],
  ] as const)(
    "holds known %s risk for exact approval",
    (_label, profile, annotations = safeAnnotations) => {
      expect(
        peerMutationGuardFailure(
          "portable__operation__0123456789abcdef",
          "arbitrary model-facing prose",
          context({ trustedProfile: profile, annotations }),
        ),
      ).toBe(HOST_APPROVAL_REQUIRED_GUARD_SENTINEL);
    },
  );

  it("releases a held proposal only through the existing exact standing state, once", () => {
    const risky = context({
      trustedProfile: { ...privateTenantProfile, exposure: "external" },
    });
    expect(
      peerMutationGuardFailure(
        "portable__operation__0123456789abcdef",
        "draft this",
        risky,
      ),
    ).toBe(HOST_APPROVAL_REQUIRED_GUARD_SENTINEL);
    expect(
      peerMutationGuardFailure(
        "portable__operation__0123456789abcdef",
        "yes, approve",
        risky,
      ),
    ).toBeNull();
    expect(
      peerMutationGuardFailure(
        "portable__operation__0123456789abcdef",
        "yes, approve",
        risky,
      ),
    ).toBe(NOTHING_PENDING_TO_APPROVE_GUARD_SENTINEL);
  });

  it.each([
    ["missing profile", context({ trustedProfile: undefined })],
    [
      "untrusted annotations",
      context({
        trustedProfile: { ...privateTenantProfile, trustMcpAnnotations: false },
      }),
    ],
    [
      "missing annotation",
      context({
        annotations: { readOnlyHint: false, destructiveHint: false },
      }),
    ],
    [
      "unknown exposure",
      context({
        trustedProfile: { ...privateTenantProfile, exposure: "unknown" },
      }),
    ],
    [
      "unknown tenant scope",
      context({
        trustedProfile: { ...privateTenantProfile, tenantScope: "unknown" },
      }),
    ],
    [
      "unknown financial scope",
      context({
        trustedProfile: { ...privateTenantProfile, financialScope: "unknown" },
      }),
    ],
  ])("fails closed for %s", (_label, guardContext) => {
    expect(
      peerMutationGuardFailure(
        "portable__operation__0123456789abcdef",
        "execute it",
        guardContext,
      ),
    ).toContain("risk metadata is incomplete or unknown");
  });
});
