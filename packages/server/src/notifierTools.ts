export interface NotifierToolEnv {
  PHYLAX_CONSOLE_URL?: string;
  PHYLAX_CONSOLE_TOKEN?: string;
}

interface NotificationRecord {
  notificationId?: string;
  channel?: string;
  at?: number;
  messageId?: string | null;
  sentMessageId?: string | null;
  contactId?: string | null;
  bodyText?: string;
  status?: string;
  errorText?: string | null;
}

function parseLedgerRequest(input: string): { query?: string; windowMinutes: number; limit: number } {
  const text = input.trim();
  const duration = text.match(/\blast\s+(\d+)\s*(minute|minutes|hour|hours|day|days)\b/i);
  const unit = duration?.[2]?.toLowerCase();
  const amount = duration ? Number(duration[1]) : NaN;
  const windowMinutes =
    Number.isFinite(amount) && unit
      ? unit.startsWith("day")
        ? amount * 24 * 60
        : unit.startsWith("hour")
          ? amount * 60
          : amount
      : 24 * 60;
  const quoted = text.match(/["'`](.{3,200}?)["'`]/);
  const execution = text.match(/\bexecution\s+#?(\d+)\b/i) ?? text.match(/\bexec(?:ution)?\s+(\d+)\b/i);
  const issue = text.match(/#(\d+)\b/);
  const query = quoted?.[1]?.trim() || execution?.[1] || issue?.[1] || "";
  return { ...(query ? { query } : {}), windowMinutes, limit: 20 };
}

function formatNotificationLedger(records: NotificationRecord[], scope: { query?: string; windowMinutes: number; limit: number }): string {
  const query = scope.query ? ` query=${JSON.stringify(scope.query)}` : "";
  const header = `Notification ledger search: channel=whatsapp windowMinutes=${scope.windowMinutes}${query} limit=${scope.limit}`;
  if (records.length === 0) return `${header}\nNo notification records found in the searched scope.`;
  const lines = records.map((record) => {
    const at = record.at ? new Date(record.at).toISOString() : "unknown-time";
    const text = (record.bodyText ?? "").replace(/\s+/g, " ").trim();
    const body = text.length > 240 ? `${text.slice(0, 237)}...` : text;
    const ids = [
      record.notificationId ? `id=${record.notificationId}` : null,
      record.messageId ? `messageId=${record.messageId}` : null,
      record.sentMessageId ? `sentMessageId=${record.sentMessageId}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const target = record.contactId ? `target=${record.contactId}` : "target=unknown";
    const error = record.errorText ? ` error=${JSON.stringify(record.errorText)}` : "";
    return `- ${at} status=${record.status ?? "unknown"} ${target}${ids ? ` ${ids}` : ""}${error} text=${JSON.stringify(body)}`;
  });
  return [header, ...lines].join("\n");
}

/**
 * Private tools for Phylax. The Console owns delivery sockets; Phylax owns the
 * decision and final wording. This bridge calls the Console's existing notify
 * API until the internal-only mesh delivery primitive is added.
 */
export function buildNotifierTools(env: NotifierToolEnv = process.env): Record<string, { description: string; run: (input: string) => Promise<string> }> {
  return {
    read_notification_ledger: {
      description:
        "Read Console's notification ledger before answering audit questions like whether a notification was sent, delivered, failed, or absent. Pass a concise filter such as 'execution 142', an exact quoted notification text, or 'last hour'. Returns records or an explicit none result with searched scope.",
      run: async (input: string) => {
        const base = env.PHYLAX_CONSOLE_URL?.trim() || "http://zenod-console:8080";
        const token = env.PHYLAX_CONSOLE_TOKEN?.trim();
        if (!token) return "Console notification ledger is not configured: PHYLAX_CONSOLE_TOKEN is missing.";
        const scope = parseLedgerRequest(input);
        const response = await fetch(`${base.replace(/\/$/, "")}/api/notifications/search`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(scope),
        });
        const body = await response.text().catch(() => "");
        if (!response.ok) {
          return `Console notification ledger read failed (${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`;
        }
        let parsed: { records?: NotificationRecord[] } = {};
        try {
          parsed = body ? (JSON.parse(body) as { records?: NotificationRecord[] }) : {};
        } catch (err) {
          return `Console notification ledger read returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
        }
        return formatNotificationLedger(parsed.records ?? [], scope);
      },
    },
    deliver_to_principal: {
      description:
        "Deliver Phylax-approved text to Jordi through the Console transport. Input should be the final concise notification text. Only call after deciding the event should interrupt or be delivered now.",
      run: async (input: string) => {
        const base = env.PHYLAX_CONSOLE_URL?.trim() || "http://zenod-console:8080";
        const token = env.PHYLAX_CONSOLE_TOKEN?.trim();
        if (!token) return "Console delivery is not configured: PHYLAX_CONSOLE_TOKEN is missing.";
        const response = await fetch(`${base.replace(/\/$/, "")}/api/notify`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: input }),
        });
        const body = await response.text().catch(() => "");
        if (!response.ok) {
          return `Console delivery failed (${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`;
        }
        return body ? `Delivered: ${body}` : "Delivered.";
      },
    },
  };
}
