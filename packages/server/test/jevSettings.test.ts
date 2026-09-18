import { describe, expect, it } from "vitest";

import { SqliteStateStore } from "zenod";

import { Settings, jevSettingFallbacks } from "../src/settings.js";

// Hosted tenant runtimes are constructed with `seedFromEnv: false`, so an
// env-configured Jev fast path is invisible to them unless it arrives as a
// setting fallback. These cases pin both paths so the flag cannot silently
// become a no-op in the multi-tenant deployment again.
function store(): SqliteStateStore {
  return new SqliteStateStore(":memory:");
}

describe("Jev setting reachability", () => {
  it("is off by default", () => {
    const s = new Settings(store());
    expect(s.jevEnabled()).toBe(false);
    expect(s.jevModel()).toBeUndefined();
    expect(s.jevConfidenceThreshold()).toBeUndefined();
  });

  it("seeds from env on the self-host path (seedFromEnv)", () => {
    const s = new Settings(store());
    s.seedFromEnv({ ZENOD_JEV_ENABLED: "1", ZENOD_JEV_MODEL: "jev-latest", ZENOD_JEV_CONFIDENCE_THRESHOLD: "0.8", TYPESAFE_API_KEY: "apikey_x" } as NodeJS.ProcessEnv);
    expect(s.jevEnabled()).toBe(true);
    expect(s.jevModel()).toBe("jev-latest");
    expect(s.jevConfidenceThreshold()).toBe(0.8);
    expect(s.getRaw("typesafe_api_key")).toBe("apikey_x");
  });

  it("reaches a hosted tenant through fallbacks even though it does not seed from env", () => {
    const fallbacks = jevSettingFallbacks({
      ZENOD_JEV_ENABLED: "1",
      ZENOD_JEV_MODEL: "jev-latest",
      ZENOD_JEV_CONFIDENCE_THRESHOLD: "0.75",
      TYPESAFE_API_KEY: "apikey_tenant",
    } as NodeJS.ProcessEnv);
    const s = new Settings(store(), undefined, fallbacks);
    // The tenant path never calls seedFromEnv.
    expect(s.jevEnabled()).toBe(true);
    expect(s.jevModel()).toBe("jev-latest");
    expect(s.jevConfidenceThreshold()).toBe(0.75);
    // The api key must be readable through the same fallback the runtime uses.
    expect(s.getRaw("typesafe_api_key")).toBe("apikey_tenant");
  });

  it("a stored value wins over the fallback", () => {
    const fallbacks = jevSettingFallbacks({ ZENOD_JEV_ENABLED: "1" } as NodeJS.ProcessEnv);
    const s = new Settings(store(), undefined, fallbacks);
    s.set("jev_enabled", "0");
    expect(s.jevEnabled()).toBe(false);
  });

  it("rejects a malformed threshold rather than silently defaulting", () => {
    const fallbacks = jevSettingFallbacks({ ZENOD_JEV_CONFIDENCE_THRESHOLD: "1.5" } as NodeJS.ProcessEnv);
    const s = new Settings(store(), undefined, fallbacks);
    expect(() => s.jevConfidenceThreshold()).toThrow(/between 0 and 1/);
  });

  it("emits no fallback keys when the env is empty", () => {
    expect(jevSettingFallbacks({} as NodeJS.ProcessEnv)).toEqual({});
  });
});
