// E14-S5 dry run: the shipped persona code (production build) on a throwaway copy of the vault.
// Model is a stub that records each prompt and replies "{}" — no model call, no spend.
// Usage: node dry.mjs <build dir> <bare vault repo> <work dir> <out.json>
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
const [B, BARE, WORK, OUT] = process.argv.slice(2);
const { createEngine, VaultRepo, SqliteStateStore } = await import(join(B, "packages/core/dist/index.js"));
const { inboxFor } = await import(join(B, "packages/server/dist/inboxStore.js"));
const { personasFor } = await import(join(B, "packages/server/dist/personaStore.js"));
const { runPersona } = await import(join(B, "packages/server/dist/personaRunner.js"));
const { BUILT_IN_PERSONAS } = await import(join(B, "packages/server/dist/personaCatalog.js"));
mkdirSync(WORK, { recursive: true });
const repo = await VaultRepo.open({ workdir: join(WORK, "work"), remoteUrl: BARE });
const engine = createEngine({ repo, llm: {}, state: new SqliteStateStore(":memory:") });
const runtime = { dataDir: WORK, tenantId: "sandbox", taskJobQueue: { enqueue: () => ({ id: "x" }) } };
const out = [];
for (const persona of BUILT_IN_PERSONAS) {
  let prompt = null, system = null;
  const model = () => ({ async complete(i) { prompt = i.prompt; system = i.system; return { text: "{}", inputTokens: 0, outputTokens: 0, costUsd: 0 }; } });
  const run = await runPersona(persona, { memory: engine, model, inbox: inboxFor(runtime), store: personasFor(runtime),
    writeNotes: async () => null, aiAllowanceBlock: () => null }, "manual");
  out.push({ id: persona.id, status: run?.status, summary: run?.summary,
    memories: prompt ? prompt.split("\n").filter((l) => /^\[\d+\]/.test(l)).length : null,
    promptChars: prompt?.length ?? 0, systemChars: system?.length ?? 0, prompt });
  console.log(persona.id, run?.status, run?.summary, prompt ? `${prompt.length} chars` : "no model call");
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
