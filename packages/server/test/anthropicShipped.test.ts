import { describe, expect, it } from "vitest";

import { runAnthropicQuestionSet } from "../src/anthropicProbe.js";
import { creditCallHealth, noteCreditCall, resetCreditCallHealth } from "../src/creditRoute.js";
import { backgroundProviderHealth } from "../src/zenodUnit.js";

// E7-S1 round 2: Anthropic is the provider every tester and new account ships on.

describe("the memory question set on the Anthropic route", () => {
  it("files one note and passes answers that carry the expected facts", async () => {
    const filing = { classify: async () => ({ summary: "bike lock code", confidence: 0.9 }) } as never;
    const answer = {
      answer: async (input: { question: string }, tools: { searchVault(q: string): Promise<string> }) => ({ text: await tools.searchVault(input.question), readPaths: [] }),
    } as never;
    const set = await runAnthropicQuestionSet(filing, answer);
    expect(set.total).toBe(4);
    expect(set.rows.map((r) => [r.id, r.ok])).toEqual([["file-note", true], ["key", true], ["router", true], ["ana", true]]);
  });

  it("fails a question whose answer leaves out a fact, and reports a refused call without throwing", async () => {
    const filing = { classify: async () => { throw Object.assign(new Error("temperature is not supported"), { statusCode: 400 }); } } as never;
    const answer = { answer: async () => ({ text: "It is under a frog.", readPaths: [] }) } as never;
    const set = await runAnthropicQuestionSet(filing, answer);
    expect(set.rows[0]).toMatchObject({ id: "file-note", ok: false });
    expect(set.rows[0]!.reply).toContain("400");
    expect(set.rows.find((r) => r.id === "key")!.ok).toBe(false);
  });
});

describe("health reports Anthropic as the background provider", () => {
  it("counts calls and names the last failure", () => {
    resetCreditCallHealth();
    expect(creditCallHealth().state).toBe("idle");
    noteCreditCall({ model: "claude-haiku-5-5" }, Date.UTC(2026, 10, 11, 6));
    noteCreditCall({ status: "failed", errorCode: "provider_error" }, Date.UTC(2026, 10, 11, 7));
    expect(creditCallHealth()).toMatchObject({ state: "failing", calls: 1, failed: 1, lastError: "provider_error", byModel: { "claude-haiku-5-5": 1 } });
    noteCreditCall({ model: "claude-sonnet-5-5" }, Date.UTC(2026, 10, 11, 8));
    expect(creditCallHealth().state).toBe("ok");
  });

  it("says anthropic for every job when every account is on it, with DeepSeek only as the switch", () => {
    const all = backgroundProviderHealth({ ZENOD_CREDIT_ANTHROPIC_API_KEY: "k", ZENOD_CREDIT_TENANTS: "all" } as NodeJS.ProcessEnv);
    expect(all).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", jobs: { filing: "anthropic", desk: "anthropic", personas: "anthropic", reflection: "anthropic" } });
    expect(JSON.stringify(all)).not.toContain("\"k\"");
    const named = backgroundProviderHealth({ ZENOD_CREDIT_ANTHROPIC_API_KEY: "k", ZENOD_CREDIT_TENANTS: "tenant-a" } as NodeJS.ProcessEnv);
    expect(named.provider).not.toBe("anthropic");
  });
});
