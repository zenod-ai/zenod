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
  return events.find(event => event.type === "done");
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
      async (app, headers) => { const result = await ask(app, headers, manifest.cases.find(test => test.id === "unknown")!.prompt); expect(result.text).not.toContain("imaginary-payroll"); expect(result.sources).toEqual([]); });
  });
});
