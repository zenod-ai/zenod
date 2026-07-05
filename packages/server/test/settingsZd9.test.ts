import { describe, expect, it } from "vitest";

import { SqliteStateStore } from "zenod";

import { Settings } from "../src/settings.js";

// ZD-9: the self-host MCP token story. A self-hoster must be able to LEARN their bearer
// token; /api/token is auth-gated (needs the token), so the token comes from either a
// pinned ZENOD_API_TOKEN or the once-at-boot log line.
function freshSettings(): Settings {
  return new Settings(new SqliteStateStore(":memory:"));
}

describe("ZD-9 self-host token seed", () => {
  it("pins the bearer to ZENOD_API_TOKEN when set", () => {
    const s = freshSettings();
    s.seedFromEnv({ ZENOD_API_TOKEN: "pinned-secret-abc123" } as NodeJS.ProcessEnv);
    expect(s.apiToken()).toBe("pinned-secret-abc123");
  });

  it("auto-mints a non-empty token when ZENOD_API_TOKEN is unset (and not awaiting provision)", () => {
    const s = freshSettings();
    s.seedFromEnv({} as NodeJS.ProcessEnv);
    expect(s.apiToken().length).toBeGreaterThan(0);
  });

  it("does NOT mint a token while awaiting provision (the provisioner sets it)", () => {
    const s = freshSettings();
    s.seedFromEnv({ ZENOD_AWAIT_PROVISION: "1" } as NodeJS.ProcessEnv);
    expect(s.apiToken()).toBe("");
  });
});
