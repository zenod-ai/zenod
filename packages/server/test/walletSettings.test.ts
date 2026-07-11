import { SqliteStateStore } from "zenod";
import { describe, expect, it } from "vitest";
import type { CredentialVault } from "../src/credentialVault.js";
import { Settings } from "../src/settings.js";

class MemoryCredentialVault implements CredentialVault {
  private readonly values = new Map<string, { handle: string; value: string }>();
  put(key: string, value: string): string {
    const handle = this.values.get(key)?.handle ?? `zenod-secret:v1:${"a".repeat(48)}`;
    this.values.set(key, { handle, value });
    return handle;
  }
  materialize(key: string, handle: string): string | null {
    const stored = this.values.get(key);
    return stored?.handle === handle ? stored.value : null;
  }
  delete(key: string, handle: string): boolean {
    const stored = this.values.get(key);
    return stored?.handle === handle ? this.values.delete(key) : false;
  }
  list() { return []; }
  close() {}
}

describe("wallet credential custody", () => {
  it("stores only a tenant-vault handle in settings and materializes for downstream calls", () => {
    const settings = new Settings(new SqliteStateStore(":memory:"), new MemoryCredentialVault());
    settings.setPeers([{ name: "Zenod", url: "https://zenod.example/mcp", token: "downstream-secret", wallet: true }]);

    expect(settings.getRaw("peers")).not.toContain("downstream-secret");
    expect(settings.getRaw("peers")).toContain("zenod-secret:v1:");
    expect(settings.peers()).toMatchObject([{ name: "Zenod", token: "downstream-secret", wallet: true }]);
  });
});
