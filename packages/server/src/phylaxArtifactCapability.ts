import { createHmac, timingSafeEqual } from "node:crypto";

const ARTIFACT_CAPABILITY_PURPOSE = "phylax-artifact-read-v1";

function capabilityPayload(tenantId: string, file: string, expires: string): string {
  return [ARTIFACT_CAPABILITY_PURPOSE, tenantId, file, expires].join("\0");
}

function capabilitySignature(secret: string, tenantId: string, file: string, expires: string): string {
  return createHmac("sha256", secret)
    .update(capabilityPayload(tenantId, file, expires), "utf8")
    .digest("base64url");
}

export function phylaxArtifactCapabilitySecret(env: NodeJS.ProcessEnv): string {
  const root = env.PHYLAX_ARTIFACT_CAPABILITY_SECRET?.trim()
    || env.CHASSIS_VAULT_MASTER_KEY?.trim();
  if (!root) throw new Error("Phylax artifact capabilities require PHYLAX_ARTIFACT_CAPABILITY_SECRET or CHASSIS_VAULT_MASTER_KEY");
  return createHmac("sha256", root).update(ARTIFACT_CAPABILITY_PURPOSE, "utf8").digest("base64url");
}

export function createPhylaxArtifactCapabilityUrl(input: {
  baseUrl: string;
  secret: string;
  tenantId: string;
  file: string;
  expiresAt: number;
}): string {
  const expires = String(Math.floor(input.expiresAt));
  const url = new URL(
    `/artifacts/${encodeURIComponent(input.tenantId)}/${encodeURIComponent(input.file)}`,
    input.baseUrl,
  );
  url.searchParams.set("expires", expires);
  url.searchParams.set(
    "signature",
    capabilitySignature(input.secret, input.tenantId, input.file, expires),
  );
  return url.toString();
}

export function verifyPhylaxArtifactCapability(input: {
  secret: string;
  tenantId: string;
  file: string;
  expires: string | null | undefined;
  signature: string | null | undefined;
  now?: number;
}): boolean {
  if (!input.expires || !input.signature) return false;
  const expiresAt = Number(input.expires);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < (input.now ?? Date.now())) return false;
  const expected = Buffer.from(
    capabilitySignature(input.secret, input.tenantId, input.file, input.expires),
    "utf8",
  );
  const received = Buffer.from(input.signature, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
