export interface TelegramSettings {
  enabled: boolean;
  /**
   * Who may DM the bot — each entry is either a @handle (Telegram username) or a
   * numeric user/chat ID. Handles are friendlier (you know yours; the numeric ID
   * needs @userinfobot), so the UI collects a handle by default.
   */
  allowedUsers: string[];
  /** When true, accept any sender (no allowlist). Useful for a private bot. */
  acceptAll: boolean;
  /** Render replies with Bot API 10.1 rich messages (markdown passthrough). */
  rich: boolean;
}

/** A Telegram user/chat ID is a bare (optionally negative) integer. */
export function normalizeTelegramId(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/[^\d-]/g, "");
}

/**
 * Normalize one allowlist entry: a numeric ID stays as digits; anything else is
 * treated as a @handle — leading "@" dropped, lowercased, restricted to the
 * username charset ([a-z0-9_]). Returns "" for empty/invalid entries.
 */
export function normalizeTelegramEntry(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim().replace(/^@/, "");
  if (/^-?\d+$/.test(trimmed)) return trimmed;
  return trimmed.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export function normalizeAllowedUsers(values: unknown): string[] {
  const raw = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(/[,\n\s]+/)
      : [];
  return [...new Set(raw.map((value) => normalizeTelegramEntry(String(value))).filter(Boolean))];
}

export function userIsAllowed(
  sender: { id?: string | number | null; username?: string | null },
  settings: Pick<TelegramSettings, "acceptAll" | "allowedUsers">,
): boolean {
  if (settings.acceptAll) return true;
  const id = sender.id != null ? normalizeTelegramEntry(String(sender.id)) : "";
  const username = sender.username ? normalizeTelegramEntry(sender.username) : "";
  return (id !== "" && settings.allowedUsers.includes(id)) || (username !== "" && settings.allowedUsers.includes(username));
}

export function parseStoredAllowedUsers(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeAllowedUsers(parsed);
  } catch {
    return normalizeAllowedUsers(value);
  }
}
