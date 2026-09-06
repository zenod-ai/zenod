import { afterEach, describe, expect, it, vi } from "vitest";
import { NoObjectGeneratedError } from "ai";
import { classificationDiagnostic } from "../src/llm/classificationDiagnostic.js";

const mock = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", async (actual) => ({ ...await actual<typeof import("ai")>(), generateObject: mock.generate }));
import { createBrainLlm } from "../src/llm/aisdk.js";

afterEach(() => { vi.restoreAllMocks(); mock.generate.mockReset(); });
const input = { content: "private source", hints: [], pageIndex: [], tagVocabulary: [] };

describe("safe classifier failure diagnostics", () => {
  it("keeps schema paths/codes while dropping values, messages and arbitrary field names", () => {
    const secret = "sk-private-customer-value";
    const err = { name: "AI_NoObjectGeneratedError", finishReason: "length", text: secret,
      cause: { name: "AI_TypeValidationError", value: secret, cause: { name: "ZodError", message: secret,
        issues: [{ code: "invalid_type", path: ["topics", 4, "facts"], input: secret, message: secret },
          { code: secret, path: ["topics", secret, "statement"], message: secret }] } } };
    expect(classificationDiagnostic(err)).toEqual({ finishReason: "length", causes: ["AI_NoObjectGeneratedError", "AI_TypeValidationError", "ZodError"],
      issues: [{ code: "invalid_type", path: "topics.[].facts" }, { code: "other", path: "topics.[redacted].statement" }] });
    expect(JSON.stringify(classificationDiagnostic(err))).not.toContain(secret);
  });

  it("bounds nested/cyclic errors and emits no arbitrary error name or finish reason", () => {
    const err: any = { name: "private name", finishReason: "private reason", issues: Array.from({ length: 30 }, () => ({ code: "custom", path: Array(30).fill("summary") })) };
    err.cause = err;
    const result = classificationDiagnostic(err);
    expect(result.finishReason).toBe("unknown");
    expect(result.causes).toEqual(["other"]);
    expect(result.issues).toHaveLength(8);
    expect(result.issues[0]!.path.split(".")).toHaveLength(8);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("preserves billable failed output usage and emits only safe operator diagnostics", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secret = "PRIVATE RAW RESPONSE sk-sensitive";
    const cause = Object.assign(new Error(secret), { name: "ZodError", issues: [{ code: "invalid_type", path: ["topics", 0, "facts"], message: secret }] });
    const err = new NoObjectGeneratedError({ text: secret, cause, response: { id: "response", timestamp: new Date(), modelId: "test" },
      usage: { inputTokens: 123, outputTokens: 45, totalTokens: 168, inputTokenDetails: { noCacheTokens: 123, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokenDetails: { textTokens: 45, reasoningTokens: 0 } }, finishReason: "stop" });
    mock.generate.mockRejectedValue(err);
    const onUsage = vi.fn();
    const llm = createBrainLlm({ provider: "openrouter", apiKey: "test", onUsage });
    await expect(llm.classify(input)).rejects.toThrow("classify: structured_output_invalid");
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ operation: "classify", status: "failed", errorCode: "structured_output_invalid", inputTokens: 123, outputTokens: 45 }));
    expect(warning).toHaveBeenCalledOnce();
    const logged = warning.mock.calls.flat().join(" ");
    expect(logged).toContain("topics.[].facts");
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain("private source");
  });

  it("keeps provider failures distinct without exposing provider error text", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mock.generate.mockRejectedValue(new Error("Authorization: secret-provider-key"));
    const onUsage = vi.fn();
    const llm = createBrainLlm({ provider: "openrouter", apiKey: "test", onUsage });
    await expect(llm.classify(input)).rejects.toThrow("classify: provider_error");
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "provider_error", status: "failed" }));
    expect(JSON.stringify(warning.mock.calls)).not.toContain("secret-provider-key");
  });
});
