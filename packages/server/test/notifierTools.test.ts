import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNotifierTools } from "../src/notifierTools.js";

describe("notifier tools", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses notification ledger reads when the Console token is missing", async () => {
    const tools = buildNotifierTools({ PHYLAX_CONSOLE_URL: "http://console.test" });
    await expect(tools.read_notification_ledger.run("execution 142")).resolves.toContain("PHYLAX_CONSOLE_TOKEN is missing");
  });

  it("reads the Console notification ledger with a parsed execution filter", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          records: [
            {
              notificationId: "whaudit_1",
              channel: "whatsapp",
              at: Date.parse("2026-06-22T18:00:00.000Z"),
              messageId: "notify-34618217703-1782149999",
              sentMessageId: "sent_142",
              contactId: "34618217703@s.whatsapp.net",
              bodyText: "✅ Execution 142 (AlfaBlok/obsidian-brain#141) — done.",
              status: "notify",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const tools = buildNotifierTools({
      PHYLAX_CONSOLE_URL: "http://console.test/",
      PHYLAX_CONSOLE_TOKEN: "console-token",
    });
    const result = await tools.read_notification_ledger.run("Was execution #142 notification sent?");
    expect(result).toContain("Notification ledger search");
    expect(result).toContain("status=notify");
    expect(result).toContain("Execution 142");
    expect(fetchMock).toHaveBeenCalledWith("http://console.test/api/notifications/search", {
      method: "POST",
      headers: {
        Authorization: "Bearer console-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "142", windowMinutes: 1440, limit: 20 }),
    });
  });

  it("refuses delivery when the Console token is missing", async () => {
    const tools = buildNotifierTools({ PHYLAX_CONSOLE_URL: "http://console.test" });
    await expect(tools.deliver_to_principal.run("hello")).resolves.toContain("PHYLAX_CONSOLE_TOKEN is missing");
  });

  it("delivers Phylax-approved text through the Console notify API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const tools = buildNotifierTools({
      PHYLAX_CONSOLE_URL: "http://console.test/",
      PHYLAX_CONSOLE_TOKEN: "console-token",
    });
    await expect(tools.deliver_to_principal.run("Decision needed on #12")).resolves.toContain("Delivered");
    expect(fetchMock).toHaveBeenCalledWith("http://console.test/api/notify", {
      method: "POST",
      headers: {
        Authorization: "Bearer console-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "Decision needed on #12" }),
    });
  });
});
