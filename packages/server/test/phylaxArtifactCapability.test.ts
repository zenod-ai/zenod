import { describe, expect, it } from "vitest";

import {
  PHYLAX_ARTIFACT_LINK_TTL_MS,
  createPhylaxArtifactCapabilityUrl,
  verifyPhylaxArtifactCapability,
} from "../src/phylaxArtifactCapability.js";

describe("Phylax artifact capability", () => {
  const secret = "artifact-capability-test-secret";
  const expiresAt = Date.parse("2026-08-01T12:00:00.000Z");

  it("issues a purpose-limited URL without a customer or MCP bearer token", () => {
    const url = createPhylaxArtifactCapabilityUrl({
      baseUrl: "https://phylax.zenod.dev",
      secret,
      tenantId: "tenant-a",
      file: "image.png",
      expiresAt,
    });

    expect(url).toMatch(/^https:\/\/phylax\.zenod\.dev\/artifacts\/tenant-a\/image\.png\?/);
    expect(url).not.toContain("/mcp/");
    expect(url).not.toContain("customer-token");
    const parsed = new URL(url);
    expect(verifyPhylaxArtifactCapability({
      secret,
      tenantId: "tenant-a",
      file: "image.png",
      expires: parsed.searchParams.get("expires"),
      signature: parsed.searchParams.get("signature"),
      now: expiresAt - 1,
    })).toBe(true);
  });

  it("rejects another tenant, another file, a tampered signature, and expiry", () => {
    const parsed = new URL(createPhylaxArtifactCapabilityUrl({
      baseUrl: "https://phylax.zenod.dev",
      secret,
      tenantId: "tenant-a",
      file: "image.png",
      expiresAt,
    }));
    const input = {
      secret,
      tenantId: "tenant-a",
      file: "image.png",
      expires: parsed.searchParams.get("expires"),
      signature: parsed.searchParams.get("signature"),
      now: expiresAt - 1,
    };

    expect(verifyPhylaxArtifactCapability({ ...input, tenantId: "tenant-b" })).toBe(false);
    expect(verifyPhylaxArtifactCapability({ ...input, file: "other.png" })).toBe(false);
    expect(verifyPhylaxArtifactCapability({ ...input, signature: "tampered" })).toBe(false);
    expect(verifyPhylaxArtifactCapability({ ...input, now: expiresAt + 1 })).toBe(false);
  });

  it("keeps a staged media link valid for a replay days later (ZAL-A16)", () => {
    // A filing outage replayed an 11-04 media save on 11-06; its 24 h link was
    // answered 404 and the message was lost.
    const issuedAt = Date.parse("2026-11-04T10:32:20.000Z");
    const url = new URL(createPhylaxArtifactCapabilityUrl({
      baseUrl: "https://phylax.zenod.dev",
      secret,
      tenantId: "tenant-a",
      file: "image.jpg",
      expiresAt: issuedAt + PHYLAX_ARTIFACT_LINK_TTL_MS,
    }));
    const check = (now: number) => verifyPhylaxArtifactCapability({
      secret,
      tenantId: "tenant-a",
      file: "image.jpg",
      expires: url.searchParams.get("expires"),
      signature: url.searchParams.get("signature"),
      now,
    });
    expect(check(Date.parse("2026-11-06T07:16:24.000Z"))).toBe(true);
    expect(check(issuedAt + 6 * 24 * 60 * 60 * 1_000)).toBe(true);
    expect(check(issuedAt + PHYLAX_ARTIFACT_LINK_TTL_MS + 1)).toBe(false);
  });
});
