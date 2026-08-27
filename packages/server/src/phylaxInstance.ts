export const PHYLAX_INSTANCE_MODES = ["zenod", "pm", "standalone"] as const;

export type PhylaxInstanceMode = (typeof PHYLAX_INSTANCE_MODES)[number];
export type PhylaxDownstreamAdapter = "zenod" | "pm" | "configured";

export interface PhylaxInstanceConfig {
  /** Stable deployment identity. It is not a customer or tenant identifier. */
  instanceId: string;
  /** One transport/session island is bound to one product mode for its lifetime. */
  mode: PhylaxInstanceMode;
  /** Fixed by mode. This is deliberately not a free-form runtime router. */
  downstreamAdapter: PhylaxDownstreamAdapter;
  /** Only native standalone customers may edit the downstream adapter binding. */
  customerConfigurableDownstream: boolean;
  /** The product that owns the customer relationship and allowance issuer. */
  commercialOwner: "zenod" | "pm" | "phylax";
  /** Stable operator label for the one service number/session owned by this island. */
  serviceNumberId: string;
  /** Operator surface for this instance; never used as customer authentication. */
  adminOrigin: string | null;
}

const MODE_CONFIG: Record<PhylaxInstanceMode, Pick<
  PhylaxInstanceConfig,
  "downstreamAdapter" | "customerConfigurableDownstream" | "commercialOwner"
>> = {
  zenod: {
    downstreamAdapter: "zenod",
    customerConfigurableDownstream: false,
    commercialOwner: "zenod",
  },
  pm: {
    downstreamAdapter: "pm",
    customerConfigurableDownstream: false,
    commercialOwner: "pm",
  },
  standalone: {
    downstreamAdapter: "configured",
    customerConfigurableDownstream: true,
    commercialOwner: "phylax",
  },
};

function boundedIdentifier(value: string | undefined, fallback: string, name: string): string {
  const resolved = value?.trim() || fallback;
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(resolved)) {
    throw new Error(`${name} must be a stable identifier using letters, numbers, dot, underscore or dash`);
  }
  return resolved;
}

function normalizedOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("PHYLAX_ADMIN_ORIGIN must use https (or localhost for local validation)");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("PHYLAX_ADMIN_ORIGIN must be an origin without path, query, credentials or fragment");
  }
  return parsed.origin;
}

/**
 * Resolve one immutable deployment-island role from environment configuration.
 *
 * The default remains `standalone` so the existing private Phylax volume can be
 * mounted by the dedicated artifact before the later no-loss mode migration.
 * New product-bound deployments must set the mode explicitly in their compose.
 */
export function resolvePhylaxInstanceConfig(env: NodeJS.ProcessEnv): PhylaxInstanceConfig {
  const requestedMode = env.PHYLAX_INSTANCE_MODE?.trim().toLowerCase() || "standalone";
  if (!PHYLAX_INSTANCE_MODES.includes(requestedMode as PhylaxInstanceMode)) {
    throw new Error(`PHYLAX_INSTANCE_MODE must be one of: ${PHYLAX_INSTANCE_MODES.join(", ")}`);
  }
  const mode = requestedMode as PhylaxInstanceMode;
  const fixed = MODE_CONFIG[mode];
  return {
    instanceId: boundedIdentifier(env.PHYLAX_INSTANCE_ID, `phylax-${mode}`, "PHYLAX_INSTANCE_ID"),
    mode,
    ...fixed,
    serviceNumberId: boundedIdentifier(
      env.PHYLAX_SERVICE_NUMBER_ID,
      `${mode}-primary`,
      "PHYLAX_SERVICE_NUMBER_ID",
    ),
    adminOrigin: normalizedOrigin(env.PHYLAX_ADMIN_ORIGIN),
  };
}

/** The dedicated image must never be repurposed as a Zenod/PM process. */
export function assertDedicatedPhylaxProcessEnv(env: NodeJS.ProcessEnv): void {
  const unit = env.ZENOD_UNIT?.trim().toLowerCase();
  if (unit && unit !== "phylax") {
    throw new Error("the dedicated Phylax artifact cannot run another ZENOD_UNIT");
  }
  const agent = env.AGENT?.trim().toLowerCase();
  if (agent && agent !== "phylax") {
    throw new Error("the dedicated Phylax artifact cannot run another AGENT");
  }
}

export function assertCustomerDownstreamMutationAllowed(
  instance: PhylaxInstanceConfig,
  update: Record<string, unknown>,
): void {
  if (instance.customerConfigurableDownstream) return;
  const routingFields = [
    "downstreamUrl",
    "downstreamToken",
    "assistantUrl",
    "assistantToken",
    "ringTicketUrl",
    "ringTicketToken",
    "voiceDefault",
    "turnBindings",
  ];
  if (routingFields.some((field) => Object.hasOwn(update, field))) {
    throw new Error(
      `${instance.mode} Phylax instances use the fixed ${instance.downstreamAdapter} adapter; `
      + "customer routing changes are not allowed",
    );
  }
}
