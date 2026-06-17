import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNotifierTools } from "../src/notifierTools.js";

describe("notifier tools", () => {
  afterEach(() => vi.restoreAllMocks());

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
