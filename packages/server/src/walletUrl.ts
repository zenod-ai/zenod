import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type WalletAddressLookup = (hostname: string) => Promise<string[]>;

const defaultLookup: WalletAddressLookup = async (hostname) => {
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => row.address);
};

/** Validate tenant-supplied downstream MCP endpoints before they enter the wallet. */
export async function validateWalletUrl(
  raw: string,
  options: { allowHosts?: readonly string[]; lookup?: WalletAddressLookup } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MCP URL must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") throw new Error("MCP URL must use HTTPS.");
  if (url.username || url.password) throw new Error("MCP URL must not contain credentials.");

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const allowHosts = new Set((options.allowHosts ?? []).map((host) => host.trim().toLowerCase()).filter(Boolean));
  if (allowHosts.has(hostname)) return url;

  const addresses = isIP(hostname) ? [hostname] : await (options.lookup ?? defaultLookup)(hostname);
  if (!addresses.length) throw new Error("MCP hostname did not resolve.");
  if (addresses.some(isPrivateAddress)) {
    throw new Error("MCP URL resolves to a private or loopback address.");
  }
  return url;
}

export function walletFleetAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.RING_UNIT_FLEET_ALLOWLIST ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}
