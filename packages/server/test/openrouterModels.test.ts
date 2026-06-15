import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { listOpenRouterTranscriptionModels } from "../src/openrouterModels.js";
import { Runtime } from "../src/runtime.js";

const COLLECTION_HTML = `
<div class="flex w-full items-center justify-between group py-6 border-b border-border/30 last:border-b-0 flex-col md:flex-row gap-3">
  <a href="/openai/gpt-4o-mini-transcribe"><h3>OpenAI: GPT-4o Mini Transcribe</h3></a>
  <div class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground/60 md:text-base justify-end md:w-40">157M tokens</div>
</div>
<div class="flex w-full items-center justify-between group py-6 border-b border-border/30 last:border-b-0 flex-col md:flex-row gap-3">
  <a href="/openai/gpt-4o-transcribe"><h3>OpenAI: GPT-4o Transcribe</h3></a>
  <div class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground/60 md:text-base justify-end md:w-40">35.1M tokens</div>
</div>`;

function detail(id: string, name: string, prompt: string, completion: string) {
  return {
    data: {
      id,
      name,
      architecture: {
        modality: "audio->transcription",
        input_modalities: ["audio"],
        output_modalities: ["transcription"],
      },
      endpoints: [
        {
          pricing: { prompt, completion },
        },
      ],
    },
  };
}

describe("OpenRouter transcription model catalog", () => {
  it("keeps OpenRouter collection order and normalizes costs", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/collections/speech-to-text-models")) return new Response(COLLECTION_HTML);
      if (url.endsWith("/openai/gpt-4o-mini-transcribe/endpoints")) {
        return Response.json(detail("openai/gpt-4o-mini-transcribe", "OpenAI: GPT-4o Mini Transcribe", "0.00000125", "0.000005"));
      }
      if (url.endsWith("/openai/gpt-4o-transcribe/endpoints")) {
        return Response.json(detail("openai/gpt-4o-transcribe", "OpenAI: GPT-4o Transcribe", "0.0000025", "0.00001"));
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const models = await listOpenRouterTranscriptionModels({ fetcher, limit: 20 });

    expect(models.map((model) => model.id)).toEqual([
      "openai/gpt-4o-mini-transcribe",
      "openai/gpt-4o-transcribe",
    ]);
    expect(models[0]).toMatchObject({
      name: "OpenAI: GPT-4o Mini Transcribe",
      inputPerMTokens: 1.25,
      outputPerMTokens: 5,
      popularityLabel: "157M tokens",
    });
    expect(models[0]!.estimatedCostPerMinute).toBeCloseTo(0.04);
  });
});

describe("OpenRouter transcription model API", () => {
  let dir: string;
  let runtime: Runtime | undefined;

  afterEach(async () => {
    runtime?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("exposes the selected OpenRouter transcription model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/collections/speech-to-text-models")) return new Response(COLLECTION_HTML);
        return Response.json(detail("openai/gpt-4o-mini-transcribe", "OpenAI: GPT-4o Mini Transcribe", "0.00000125", "0.000005"));
      }),
    );

    dir = await mkdtemp(join(tmpdir(), "zenod-openrouter-models-"));
    runtime = new Runtime(dir);
    runtime.settings.setAdminPassword("hunter2hunter2");
    runtime.settings.set("openrouter_transcription_model", "openai/gpt-4o-mini-transcribe");
    const app = createApp(runtime);
    const login = await app.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "hunter2hunter2" }),
    });
    const cookie = login.headers.get("set-cookie")!;

    const response = await app.request("/api/transcription/openrouter-models", { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.selected).toBe("openai/gpt-4o-mini-transcribe");
    expect(body.models[0].id).toBe("openai/gpt-4o-mini-transcribe");
  });
});
