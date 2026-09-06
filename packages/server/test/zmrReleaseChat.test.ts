import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { createEngine } from "zenod";
import type { AnswerInput, BrainLlm, VaultReadTools } from "../../core/src/llm/types.js";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";
import { FakeDriveVaultRepository } from "./fixtures/zmr/driveRepository.js";
import { manifest, seedFixture } from "./fixtures/zmr/fixture.js";

// Release-level HTTP seam probe. Reuses frozen fixture and repository double;
// only the model is scripted. No customer credentials or remote calls.
async function journey(answer: (input: AnswerInput, tools: VaultReadTools) => Promise<{ text: string; readPaths: string[] }>, check: (app: ReturnType<typeof createApp>, headers: Record<string, string>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "zmr-release-chat-"));
  const runtime = new Runtime(join(dir, "runtime"));
  try {
    await seedFixture(join(dir, "vault"));
    const repo = await FakeDriveVaultRepository.open(join(dir, "vault"));
    const engine = createEngine({ repo, state: runtime.state, llm: { answer } as BrainLlm, now: () => new Date("2026-09-06T00:00:00Z") });
    runtime.getEngine = async () => engine;
    const app = createApp(runtime);
    await check(app, { Authorization: `Bearer ${runtime.settings.apiToken()}`, "Content-Type": "application/json" });
  } finally { runtime.close(); await rm(dir, { recursive: true, force: true }); }
}
async function ask(app: ReturnType<typeof createApp>, headers: Record<string,string>, message: string) {
  const response = await app.request("/api/chat/stream", { method: "POST", headers, body: JSON.stringify({ message }) });
  expect(response.status).toBe(200);
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  expect(events.some(event => event.type === "error"), JSON.stringify(events)).toBe(false);
  const done = events.find(event => event.type === "done");
  expect(events.filter(event => event.type === "delta").map(event => event.text).join("")).toBe(done.text);
  return done;
}

describe("ZMR-8 customer streaming chat parity", () => {
  beforeAll(() => vi.stubEnv("ZENOD_API_TOKEN", "synthetic-zmr8-local-token"));
  afterAll(() => vi.unstubAllEnvs());
  it("retrieves a late exact passage through authenticated customer chat", async () => {
    await journey(async (_input, tools) => {
      const passage = JSON.parse(await tools.readNote!(manifest.refs.late, { query: "cobalt-seventeen" }));
      expect(passage.body).toContain("cobalt-seventeen");
      expect(passage.body).not.toContain("original launch color");
      return { text: "cobalt-seventeen", readPaths: [manifest.refs.late] };
    }, async (app, headers) => {
      expect((await app.request("/api/chat/stream", { method: "POST", body: JSON.stringify({ message: "hi" }) })).status).toBe(401);
      const result = await ask(app, headers, manifest.cases[0].prompt);
      expect(result.text).toContain("cobalt-seventeen");
      expect(result.sources).toEqual(expect.arrayContaining([expect.objectContaining({ path: manifest.refs.late, provider: "google_drive" })]));
    });
  });
  it("offers typed enumeration to the customer memory answer loop", async () => {
    let available = false;
    await journey(async (_input, tools) => { available = typeof tools.searchEntries === "function"; return { text: "No enumeration performed.", readPaths: [] }; },
      async (app, headers) => { await ask(app, headers, "List all captures on January 1, 2026."); expect(available).toBe(true); });
  });
  it("rejects unverified sources and unsupported model claims on customer chat", async () => {
    await journey(async () => ({ text: "The payroll provider is imaginary-payroll.", readPaths: [manifest.refs.late] }),
      async (app, headers) => { const result = await ask(app, headers, manifest.cases.find(test => test.id === "unknown")!.prompt); expect.soft(result.text).not.toContain("imaginary-payroll"); expect.soft(result.sources).toEqual([]); });
  });
  it("does not turn unknown legacy fact status into current live verification", async () => {
    await journey(async (_input, tools) => {
      const view = JSON.parse(await tools.readFacts!({ path: "Areas/Insurance.md" }));
      expect(view.legacy).toBe(true);
      expect(view.facts).toEqual([]);
      return { text: "Production is definitely broken and live verified.", readPaths: ["Areas/Insurance.md"] };
    }, async (app, headers) => {
      const result = await ask(app, headers, "Is the old insurance incident still broken in production now?");
      expect(result.text).not.toContain("definitely broken and live verified");
    });
  });
  it("withholds incomplete historical enumeration and exposes usable continuation on the streaming boundary", async () => {
    await journey(async (input, tools) => {
      const catalog = JSON.parse(await tools.searchEntries!({ exhaustive: true }));
      expect(catalog.coverage.status).toBe("partial");
      input.onTextDelta?.("This is the complete audit of every memory.");
      return { text: "This is the complete audit of every memory.", readPaths: [] };
    }, async (app, headers) => {
      const result = await ask(app, headers, "Give a complete audit of all memories.");
      expect(result.text).toContain("Coverage is partial");
      expect(result.text).not.toContain("This is the complete audit");
      expect(result.coverage.status).toBe("partial");
      expect(result.coverage.entryPagesRead).toBe(8);
      expect(result.coverage.continuation).toEqual(expect.arrayContaining([
        expect.objectContaining({ tool: "search_entries", input: expect.objectContaining({ cursor: expect.any(String) }) }),
      ]));
    });
  });
  it("uses the same temporal finalizer on nonstreaming tasking chat", async () => {
    await journey(async (_input, tools) => {
      await tools.readFacts!({ path: "Areas/Insurance.md" });
      return { text: "Production is definitely broken and live verified.", readPaths: ["Areas/Insurance.md"] };
    }, async (app, headers) => {
      const response = await app.request("/api/chat", { method: "POST", headers, body: JSON.stringify({ message: "Is the old insurance incident still broken in production now?" }) });
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.text).not.toContain("definitely broken and live verified");
      expect(result.text).toMatch(/unknown|no structured|legacy/i);
      expect(result.sources).toEqual([]);
      expect(result.coverage.contract).toBe("ask-coverage-v1");
    });
  });
  it("does not expose unsupported model deltas or preserve them in the conversation", async () => {
    await journey(async (input) => {
      expect(input.conversation.some(message => message.text.includes("imaginary-payroll"))).toBe(false);
      input.onTextDelta?.("The payroll provider is imaginary-payroll.");
      return { text: "The payroll provider is imaginary-payroll.", readPaths: [manifest.refs.late] };
    }, async (app, headers) => {
      const prompt = manifest.cases.find(test => test.id === "unknown")!.prompt;
      for (let i = 0; i < 2; i++) {
        const result = await ask(app, headers, prompt);
        expect(result.text).not.toContain("imaginary-payroll");
        expect(result.sources).toEqual([]);
      }
    });
  });
  it("preserves ordinary conversational streaming without invented citations", async () => {
    await journey(async input => {
      input.onTextDelta?.("Hello!");
      return { text: "Hello!", readPaths: [] };
    }, async (app, headers) => {
      const result = await ask(app, headers, "Hello");
      expect(result.text).toBe("Hello!");
      expect(result.sources).toEqual([]);
    });
  });

});
