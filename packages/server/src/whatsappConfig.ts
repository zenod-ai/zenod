export interface WhatsAppSettings {
  enabled: boolean;
  allowedSenders: string[];
  groupsEnabled: boolean;
  acceptAll: boolean;
}

export function normalizeWhatsAppIdentifier(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/:.*@/, "@")
    .replace(/@.*/, "")
    .replace(/^\+/, "")
    .replace(/[^\d*]/g, "");
}

export function normalizeAllowedSenders(values: unknown): string[] {
  const raw = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(/[,\n]/)
      : [];
  return [...new Set(raw.map((value) => normalizeWhatsAppIdentifier(String(value))).filter(Boolean))];
}

export function senderIsAllowed(senderId: string, settings: Pick<WhatsAppSettings, "acceptAll" | "allowedSenders">): boolean {
  if (settings.acceptAll) return true;
  const normalized = normalizeWhatsAppIdentifier(senderId);
  return normalized !== "" && settings.allowedSenders.includes(normalized);
}

export function maskPhoneNumber(value: string | null | undefined): string | null {
  const normalized = normalizeWhatsAppIdentifier(value);
  if (!normalized) return null;
  if (normalized.length <= 4) return `••••${normalized}`;
  return `••••${normalized.slice(-4)}`;
}

export function parseStoredAllowedSenders(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeAllowedSenders(parsed);
  } catch {
    return normalizeAllowedSenders(value);
  }
}
