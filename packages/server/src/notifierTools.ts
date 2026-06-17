export interface NotifierToolEnv {
  PHYLAX_CONSOLE_URL?: string;
  PHYLAX_CONSOLE_TOKEN?: string;
}

/**
 * Private tools for Phylax. The Console owns delivery sockets; Phylax owns the
 * decision and final wording. This bridge calls the Console's existing notify
 * API until the internal-only mesh delivery primitive is added.
 */
export function buildNotifierTools(env: NotifierToolEnv = process.env): Record<string, { description: string; run: (input: string) => Promise<string> }> {
  return {
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
