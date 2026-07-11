import { describe, expect, it } from "vitest";
import { validateWalletUrl } from "../src/walletUrl.js";

describe("Ring wallet URL policy", () => {
  it("accepts public HTTPS endpoints", async () => {
    await expect(validateWalletUrl("https://zenod.example/mcp", { lookup: async () => ["203.0.113.10"] }))
      .resolves.toMatchObject({ protocol: "https:", hostname: "zenod.example" });
  });

  it.each(["http://zenod.example/mcp", "https://127.0.0.1/mcp", "https://10.1.2.3/mcp"])(
    "rejects unsafe endpoint %s",
    async (url) => {
      await expect(validateWalletUrl(url)).rejects.toThrow();
    },
  );

  it("rejects DNS rebinding into private space", async () => {
    await expect(validateWalletUrl("https://unit.example/mcp", { lookup: async () => ["192.168.1.7"] }))
      .rejects.toThrow(/private or loopback/);
  });

  it("allows only explicitly named fleet hosts to resolve privately", async () => {
    await expect(validateWalletUrl("https://zenod.internal/mcp", {
      allowHosts: ["zenod.internal"],
      lookup: async () => ["10.0.0.8"],
    })).resolves.toMatchObject({ hostname: "zenod.internal" });
  });
});
