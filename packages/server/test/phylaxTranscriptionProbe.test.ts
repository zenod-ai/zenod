import { describe, expect, it, vi } from "vitest";
import { probePhylaxTranscriptionProvider } from "../src/phylaxTranscriptionProbe.js";

describe("probePhylaxTranscriptionProvider", () => {
  it("validates local configuration without making a network request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      probePhylaxTranscriptionProvider({
        provider: "local",
        model: "base",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ ok: true, provider: "local", model: "base" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks OpenRouter through its authenticated key endpoint and sanitizes rejection", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: "do not expose upstream bodies" }),
          { status: 401 },
        ),
      );
    const result = await probePhylaxTranscriptionProvider({
      provider: "openrouter",
      model: "openai/whisper-large-v3-turbo",
      key: "tenant-secret",
      fetchImpl,
      openRouterCatalog: {
        models: [{ id: "openai/whisper-large-v3-turbo" }],
        fallback: false,
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tenant-secret",
        }),
      }),
    );
    expect(result).toEqual({
      ok: false,
      provider: "openrouter",
      model: "openai/whisper-large-v3-turbo",
      message: "openrouter rejected this provider key",
      reason: "provider_auth_failed",
      httpStatus: 401,
    });
    expect(JSON.stringify(result)).not.toContain("tenant-secret");
    expect(JSON.stringify(result)).not.toContain("upstream bodies");
  });

  it("requires the configured Groq transcription model to be available", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ data: [{ id: "whisper-large-v3-turbo" }] }),
      );
    await expect(
      probePhylaxTranscriptionProvider({
        provider: "groq",
        key: "groq-secret",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      ok: true,
      provider: "groq",
      model: "whisper-large-v3-turbo",
    });
  });

  it("reports an exhausted OpenRouter key as not ready", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { limit_remaining: 0 } }));
    await expect(
      probePhylaxTranscriptionProvider({
      provider: "openrouter",
      key: "openrouter-secret",
      fetchImpl,
      openRouterCatalog: {
        models: [{ id: "openai/whisper-large-v3-turbo" }],
        fallback: false,
      },
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "provider_credit_exhausted",
      message:
        "OpenRouter accepted the key but its configured limit has no remaining credit",
    });
  });

  it("does not green-light a key when the selected OpenRouter model is unavailable", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { limit_remaining: 10 } }));
    await expect(
      probePhylaxTranscriptionProvider({
        provider: "openrouter",
        model: "vendor/stale-model",
        key: "openrouter-secret",
        fetchImpl,
        openRouterCatalog: {
          models: [{ id: "openai/whisper-large-v3-turbo" }],
          fallback: false,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "model_unavailable",
      message:
        "OpenRouter accepted the key, but vendor/stale-model is not in its live transcription catalog",
    });
  });

  it("does not claim model readiness from the fallback OpenRouter catalog", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { limit_remaining: 10 } }));
    await expect(
      probePhylaxTranscriptionProvider({
        provider: "openrouter",
        key: "openrouter-secret",
        fetchImpl,
        openRouterCatalog: {
          models: [{ id: "openai/whisper-large-v3-turbo" }],
          fallback: true,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "catalog_unverified",
      message:
        "OpenRouter accepted the key, but live transcription model availability could not be verified",
    });
  });

  it.each([
    [429, JSON.stringify({ error: { code: "rate_limit_exceeded", message: "slow down" } }), "provider_rate_limited"],
    [402, JSON.stringify({ error: { message: "This request requires at least $0.50 in balance for audio" } }), "provider_credit_exhausted"],
    [401, JSON.stringify({ error: { code: "invalid_api_key" } }), "provider_auth_failed"],
    [503, "<html>upstream down</html>", "provider_unavailable"],
  ])("distinguishes probe failure reason for status %i", async (status, body, reason) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }));
    await expect(
      probePhylaxTranscriptionProvider({
        provider: "openrouter",
        key: "openrouter-secret",
        fetchImpl,
        openRouterCatalog: { models: [{ id: "openai/whisper-large-v3-turbo" }], fallback: false },
      }),
    ).resolves.toMatchObject({ ok: false, reason, httpStatus: status });
  });

  it("reports a network failure as a network reason without leaking the key", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }),
    );
    const result = await probePhylaxTranscriptionProvider({
      provider: "groq",
      key: "groq-secret",
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, reason: "network_error" });
    expect(JSON.stringify(result)).not.toContain("groq-secret");
  });
});
