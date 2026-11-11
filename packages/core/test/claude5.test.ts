import { describe, expect, it } from "vitest";

import { claude5Body, claude5Fetch, claude5Params, isClaude5 } from "../src/llm/claude5.js";

// E7-S1 round 2: Claude 5 models refuse what this AI SDK release sends for unknown models.

const base = { prompt: [], temperature: 0, topP: 0.9, topK: 5 } as never;

describe("Claude 5 request shape", () => {
  it("knows the Claude 5 family only", () => {
    expect(isClaude5("claude-haiku-5-5")).toBe(true);
    expect(isClaude5("claude-sonnet-5-5")).toBe(true);
    expect(isClaude5("claude-sonnet-4-6")).toBe(false);
    expect(isClaude5("deepseek-flash")).toBe(false);
  });

  it("drops sampling parameters and asks for native structured output", () => {
    const out = claude5Params("claude-haiku-5-5", base) as Record<string, unknown>;
    expect(out.temperature).toBeUndefined();
    expect(out.topP).toBeUndefined();
    expect(out.topK).toBeUndefined();
    expect((out.providerOptions as { anthropic: Record<string, unknown> }).anthropic).toEqual({ structuredOutputMode: "outputFormat" });
  });

  it("keeps forced tool use on Haiku, turns it into auto on Sonnet 5.5, and sets Sonnet's effort", () => {
    const forced = { ...(base as object), toolChoice: { type: "required" } } as never;
    expect((claude5Params("claude-haiku-5-5", forced) as { toolChoice: unknown }).toolChoice).toEqual({ type: "required" });
    const sonnet = claude5Params("claude-sonnet-5-5", forced) as { toolChoice: unknown; providerOptions: { anthropic: Record<string, unknown> } };
    expect(sonnet.toolChoice).toEqual({ type: "auto" });
    expect(sonnet.providerOptions.anthropic.effort).toBe("medium");
    const named = claude5Params("claude-sonnet-5-5", { ...(base as object), toolChoice: { type: "tool", toolName: "x" } } as never) as { toolChoice: unknown };
    expect(named.toolChoice).toEqual({ type: "auto" });
    const none = claude5Params("claude-sonnet-5-5", { ...(base as object), toolChoice: { type: "none" } } as never) as { toolChoice: unknown };
    expect(none.toolChoice).toEqual({ type: "none" });
  });

  it("leaves other models untouched", () => {
    expect(claude5Params("claude-sonnet-4-6", base)).toBe(base);
  });

  it("turns Haiku 5.5 thinking off unless the call set it", () => {
    const body: Record<string, unknown> = { model: "claude-haiku-5-5" };
    expect(claude5Body(body)).toBe(true);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(claude5Body({ model: "claude-haiku-5-5", thinking: { type: "adaptive" } })).toBe(false);
    expect(claude5Body({ model: "claude-haiku-5-5", output_config: { effort: "max" } })).toBe(false);
    expect(claude5Body({ model: "claude-sonnet-5-5" })).toBe(false);
  });

  it("patches the Messages request on the wire", async () => {
    const seen: string[] = [];
    const fake = (async (_input: unknown, init?: RequestInit) => { seen.push(String(init?.body)); return new Response("{}"); }) as typeof fetch;
    await claude5Fetch(fake)("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-haiku-5-5" }) });
    expect(JSON.parse(seen[0]!).thinking).toEqual({ type: "disabled" });
  });
});

describe("Claude 5 through the AI SDK", () => {
  it("sends a body Sonnet 5.5 and Haiku 5.5 accept, and reads native structured output", async () => {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const { generateObject, generateText, tool, jsonSchema } = await import("ai");
    const { claude5Model } = await import("../src/llm/claude5.js");
    const { z } = await import("zod");
    const bodies: Array<Record<string, unknown>> = [];
    const stub = (async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      const content = (body.output_config as { format?: unknown } | undefined)?.format
        ? [{ type: "text", text: "{\"page\":\"Home\"}" }]
        : [{ type: "text", text: "ok" }];
      return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: body.model, content, stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 3, output_tokens: 2 } }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const anthropic = createAnthropic({ apiKey: "sk-ant-test", fetch: claude5Fetch(stub) });
    const object = await generateObject({ model: claude5Model("claude-haiku-5-5", anthropic("claude-haiku-5-5")), schema: z.object({ page: z.string() }), prompt: "x", temperature: 0 });
    expect(object.object).toEqual({ page: "Home" });
    expect(bodies[0]!.temperature).toBeUndefined();
    expect(bodies[0]!.tool_choice).toBeUndefined();
    expect(bodies[0]!.thinking).toEqual({ type: "disabled" });
    expect((bodies[0]!.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    await generateText({
      model: claude5Model("claude-sonnet-5-5", anthropic("claude-sonnet-5-5")), prompt: "x", temperature: 0, toolChoice: "required",
      tools: { search: tool({ description: "search", inputSchema: jsonSchema({ type: "object", properties: {} }) }) },
    });
    expect(bodies[1]!.temperature).toBeUndefined();
    expect(bodies[1]!.tool_choice).toEqual({ type: "auto" });
    expect(bodies[1]!.thinking).toBeUndefined();
    expect((bodies[1]!.output_config as { effort: string }).effort).toBe("medium");
  });
});
