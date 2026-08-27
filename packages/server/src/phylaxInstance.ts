import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

export type PhylaxPersistedInstanceIdentity = Pick<
  PhylaxInstanceConfig,
  "instanceId" | "mode" | "serviceNumberId"
>;

export const PHYLAX_INSTANCE_IDENTITY_FILE = "phylax-instance.json";

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

function persistedIdentity(instance: PhylaxInstanceConfig): PhylaxPersistedInstanceIdentity {
  return {
    instanceId: instance.instanceId,
    mode: instance.mode,
    serviceNumberId: instance.serviceNumberId,
  };
}

function readPersistedIdentity(path: string): PhylaxPersistedInstanceIdentity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Phylax instance identity at ${path} is unreadable; refusing to start`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Phylax instance identity at ${path} is invalid; refusing to start`);
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.instanceId !== "string"
    || !PHYLAX_INSTANCE_MODES.includes(record.mode as PhylaxInstanceMode)
    || typeof record.serviceNumberId !== "string"
  ) {
    throw new Error(`Phylax instance identity at ${path} is invalid; refusing to start`);
  }
  return {
    instanceId: record.instanceId,
    mode: record.mode as PhylaxInstanceMode,
    serviceNumberId: record.serviceNumberId,
  };
}

/**
 * Bind a data volume to one deployment island before any channel/session runtime
 * is constructed. A legacy volume with no marker is adopted in place; after the
 * first boot every identity field is immutable and mismatches fail closed.
 */
export function bindPhylaxInstanceIdentity(
  dataDir: string,
  instance: PhylaxInstanceConfig,
): PhylaxPersistedInstanceIdentity {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, PHYLAX_INSTANCE_IDENTITY_FILE);
  const expected = persistedIdentity(instance);
  try {
    writeFileSync(path, `${JSON.stringify(expected, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return expected;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  }
  const actual = readPersistedIdentity(path);
  if (
    actual.instanceId !== expected.instanceId
    || actual.mode !== expected.mode
    || actual.serviceNumberId !== expected.serviceNumberId
  ) {
    throw new Error(
      `Phylax data volume is bound to ${actual.instanceId}/${actual.mode}/${actual.serviceNumberId}; `
      + `refusing requested ${expected.instanceId}/${expected.mode}/${expected.serviceNumberId}`,
    );
  }
  return actual;
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
