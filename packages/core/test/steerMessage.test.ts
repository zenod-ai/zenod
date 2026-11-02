import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import {
  isSteerReply,
  isUndoableSteerReply,
  parseSteerMessage,
  planSteer,
  resolveRoot,
  revertOf,
  steerAppliedReply,
  type SteerIntent,
  type SteerRoot,
} from "../src/engine/steerMessage.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import type { BrainLlm } from "../src/llm/types.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { parseNote } from "../src/vault/frontmatter.js";
import { TREE_PATH, type TreeNode } from "../src/vault/tree.js";
import { lintTree } from "../src/vault/treeLint.js";
import { parseKeeperNotes } from "../src/vault/treeSteering.js";

/**
 * EPIC-9 E9-5e: steering by message. Done check (E9-4 §10): the six phrasings ("pin X", "rename X
 * to Y", "X is Y", "X is not Y", "that's wrong", "yes, close X") parsed in English and Spanish
 * (and Catalan, which Jordi mixes in); each becomes a Keeper note or an undo, read before filing.
 */

describe("E9-5e parse: six phrasings in English, Spanish and Catalan", () => {
  const cases: Array<[string, SteerIntent, "en" | "es"]> = [
    // pin X
    ["pin Agent Team", { kind: "pin", root: "Agent Team" }, "en"],
    ["Pin the topic Agent Team please.", { kind: "pin", root: "Agent Team" }, "en"],
    ["fija Agent Team", { kind: "pin", root: "Agent Team" }, "es"],
    ["Ancla el tema Familia", { kind: "pin", root: "Familia" }, "es"],
    ["fixa la Família", { kind: "pin", root: "Família" }, "es"],
    // rename X to Y
    ["rename Housing to House", { kind: "rename", root: "Housing", name: "House" }, "en"],
    ["Housing should be called Home", { kind: "rename", root: "Housing", name: "Home" }, "en"],
    ["renombra Housing a Casa", { kind: "rename", root: "Housing", name: "Casa" }, "es"],
    ["cambia el nombre de Housing a Casa nueva", { kind: "rename", root: "Housing", name: "Casa nueva" }, "es"],
    ["reanomena Housing a Casa", { kind: "rename", root: "Housing", name: "Casa" }, "es"],
    // X is Y
    ["Agentine is the agent team", { kind: "alias", a: "Agentine", b: "agent team", explicit: false }, "en"],
    ["agentine means Agent Team", { kind: "alias", a: "agentine", b: "Agent Team", explicit: true }, "en"],
    ["Agentine es el equipo de agentes", { kind: "alias", a: "Agentine", b: "equipo de agentes", explicit: false }, "es"],
    ["Agentine es lo mismo que Agent Team", { kind: "alias", a: "Agentine", b: "Agent Team", explicit: true }, "es"],
    ["Agentine és l'Agent Team", { kind: "alias", a: "Agentine", b: "Agent Team", explicit: false }, "es"],
    // X is not Y
    ["EpicSpine is not Agentine", { kind: "keep-apart", a: "EpicSpine", b: "Agentine" }, "en"],
    ["EpicSpine isn't part of Agent Team", { kind: "keep-apart", a: "EpicSpine", b: "Agent Team" }, "en"],
    ["keep Zenod and EpicSpine apart", { kind: "keep-apart", a: "Zenod", b: "EpicSpine" }, "en"],
    ["EpicSpine no es Agentine", { kind: "keep-apart", a: "EpicSpine", b: "Agentine" }, "es"],
    ["EpicSpine no és part de l'Agent Team", { kind: "keep-apart", a: "EpicSpine", b: "Agent Team" }, "es"],
    ["separa EpicSpine de Zenod", { kind: "keep-apart", a: "EpicSpine", b: "Zenod" }, "es"],
    // that's wrong
    ["that's wrong", { kind: "undo", explicit: false }, "en"],
    ["No, that’s not right.", { kind: "undo", explicit: false }, "en"],
    ["undo the last tree change", { kind: "undo", explicit: true }, "en"],
    ["eso está mal", { kind: "undo", explicit: false }, "es"],
    ["No, está mal, deshazlo", { kind: "undo", explicit: false }, "es"],
    ["deshaz el último cambio del árbol", { kind: "undo", explicit: true }, "es"],
    ["això està malament", { kind: "undo", explicit: false }, "es"],
    // yes, close X
    ["yes, close House", { kind: "close", root: "House", confirmed: true }, "en"],
    ["close Hair transplant", { kind: "close", root: "Hair transplant", confirmed: false }, "en"],
    ["sí, cierra House", { kind: "close", root: "House", confirmed: true }, "es"],
    ["Sí, tanca la casa", { kind: "close", root: "casa", confirmed: true }, "es"],
  ];
  it.each(cases)("%s", (message, intent, lang) => {
    expect(parseSteerMessage(message)).toEqual({ intent, lang });
  });

  it("reads none of these as a steer: questions, long or multi-line messages", () => {
    for (const message of [
      "is Zenod pinned?",
      "¿está mal esto?",
      "pin Agent Team\nand also remember the dentist on Monday",
      `Agentine is ${"a very long description of what the agent team does all day ".repeat(3)}`,
      "remind me to call the bank",
      "",
    ]) expect(parseSteerMessage(message)).toBeNull();
  });
});

const node = (name: string, kind: "working" | "long-term", path: string, id?: string): TreeNode => ({ name, kind, path, summary: "", line: 1, ...(id ? { id } : {}) });
const ROOTS: SteerRoot[] = [
  { node: node("Zenod", "working", "Projects/Zenod.md", "n-b9132087"), path: "Projects/Zenod.md", aliases: [] },
  { node: node("Agent Team", "working", "Projects/Agent Team.md", "n-9dabcdd4"), path: "Projects/Agent Team.md", aliases: ["agentine", "agent_team"] },
  { node: node("EpicSpine", "working", "Projects/EpicSpine.md", "n-c3cea2db"), path: "Projects/EpicSpine.md", aliases: [] },
  { node: node("Housing", "working", "Projects/Housing.md"), path: "Projects/Housing.md", aliases: [] },
  { node: node("Alpha9 Tax and AEAT", "working", "Projects/Alpha9.md"), path: "Projects/Alpha9.md", aliases: [] },
  { node: node("Zenod (earlier)", "long-term", "Areas/Zenod earlier.md"), path: "Areas/Zenod earlier.md", aliases: [] },
  { node: node("Family", "long-term", "Areas/Family.md"), path: "Areas/Family.md", aliases: [] },
  { node: node("Family trips", "long-term", "Areas/Family trips.md"), path: "Areas/Family trips.md", aliases: [] },
];
const plan = (message: string) => planSteer(parseSteerMessage(message)!, ROOTS);
const applied = (message: string) => {
  const p = plan(message);
  if (p.type !== "apply") throw new Error(`${message}: ${JSON.stringify(p)}`);
  return { action: p.apply.action, root: p.apply.root.node.name, name: p.apply.name, aliases: p.apply.aliases, others: p.apply.others?.map(o => o.node.name) };
};

describe("E9-5e plan: resolve roots, ask when unsure, let ordinary sentences through", () => {
  it("resolves by name, alias, id and words, ignoring case, accents and underscores", () => {
    expect(resolveRoot("agent_team", ROOTS)).toMatchObject({ kind: "one", root: { node: { name: "Agent Team" } } });
    expect(resolveRoot("AGENTINE", ROOTS)).toMatchObject({ kind: "one", root: { node: { name: "Agent Team" } } });
    expect(resolveRoot("n-c3cea2db", ROOTS)).toMatchObject({ kind: "one", root: { node: { name: "EpicSpine" } } });
    expect(resolveRoot("alpha9", ROOTS)).toMatchObject({ kind: "one", root: { node: { name: "Alpha9 Tax and AEAT" } } });
    // "Zenod" is exactly one root's name, though another root's name holds the word.
    expect(resolveRoot("Zenod", ROOTS)).toMatchObject({ kind: "one", root: { node: { name: "Zenod" } } });
    expect(resolveRoot("family", ROOTS)).toMatchObject({ kind: "one", root: { node: { name: "Family" } } });
  });

  it("plans each steer onto the tree", () => {
    expect(applied("pin Agentine")).toMatchObject({ action: "pin", root: "Agent Team" });
    expect(applied("fija EpicSpine")).toMatchObject({ action: "pin", root: "EpicSpine" });
    expect(applied("rename Housing to House")).toMatchObject({ action: "rename", root: "Housing", name: "House" });
    expect(applied("renombra Housing a Casa")).toMatchObject({ action: "rename", root: "Housing", name: "Casa" });
    expect(applied("Agentic crew is the agent team")).toMatchObject({ action: "alias", root: "Agent Team", aliases: ["Agentic crew"] });
    expect(applied("Agent Team means the agentic crew")).toMatchObject({ action: "alias", root: "Agent Team", aliases: ["agentic crew"] });
    expect(applied("EpicSpine is not Agentine")).toMatchObject({ action: "keep-apart", root: "EpicSpine", others: ["Agent Team"] });
    expect(applied("EpicSpine no es Zenod")).toMatchObject({ action: "keep-apart", root: "EpicSpine", others: ["Zenod"] });
    expect(applied("yes, close Housing")).toMatchObject({ action: "close", root: "Housing" });
    expect(applied("sí, cierra Housing")).toMatchObject({ action: "close", root: "Housing" });
    expect(plan("that's wrong")).toEqual({ type: "undo" });
  });

  it("asks a short question for an ambiguous or unknown root instead of guessing", () => {
    const ambiguous = plan("pin Zenod earlier family");
    expect(ambiguous.type).toBe("reply");
    const many = plan("pin family trips earlier");
    expect(many.type).toBe("reply");
    const fam = planSteer(parseSteerMessage("pin fam")!, ROOTS);
    expect(fam).toMatchObject({ type: "reply" });
    expect((fam as { text: string }).text).toMatch(/^Memory tree: I don't have a topic called "fam"\. Which one did you mean\? Your working topics: Zenod, Agent Team/);
    const two = planSteer(parseSteerMessage("pin trips")!, [...ROOTS, { node: node("Work trips", "long-term", "Areas/Work trips.md"), path: "Areas/Work trips.md", aliases: [] }]);
    expect((two as { text: string }).text).toBe('Memory tree: "trips" could be "Family trips" or "Work trips". Which one?');
    const es = planSteer(parseSteerMessage("fija viajes")!, ROOTS);
    expect((es as { text: string }).text).toMatch(/^Árbol de memoria: no tengo ningún tema llamado "viajes"\. ¿Cuál querías decir\?/);
    expect(plan("yes, close the garage")).toMatchObject({ type: "reply" });
    // Two topics "being" each other is a merge, which this version does not do by message.
    expect((plan("EpicSpine is the same as Zenod") as { text: string }).text).toMatch(/can't merge topics by message yet/);
  });

  it("lets ordinary sentences through to normal chat and filing", () => {
    for (const message of ["Zenod is great", "the trip is not cancelled", "Housing is not ready yet", "close the window", "the dentist is on Monday", "Zenod es genial", "la reunión no es mañana"]) {
      expect(parseSteerMessage(message) === null || plan(message).type === "pass").toBe(true);
    }
  });

  it("a pin on a long-term root says it keeps its name and stays long-term", () => {
    const family = ROOTS.find(r => r.node.name === "Family")!;
    expect(steerAppliedReply({ action: "pin", root: family }, "K-9", "en")).toMatch(/^Memory tree: pinned "Family"\. It keeps this name and stays a topic of its own; it is in long-term memory now/);
  });

  it("marks every steer reply so a bare \"that's wrong\" right after one is an undo", () => {
    expect(isSteerReply("Memory tree: pinned \"Zenod\".")).toBe(true);
    expect(isSteerReply("Árbol de memoria: he fijado \"Zenod\".")).toBe(true);
    expect(isSteerReply("Your dentist is on Monday.")).toBe(false);
    expect(isUndoableSteerReply('Memory tree: pinned "Zenod" (note K-4). To undo it, reply "that\'s wrong".')).toBe(true);
    expect(isUndoableSteerReply('Memory tree: I don\'t have a topic called "fam". Which one did you mean?')).toBe(false);
    expect(revertOf("memory: keeper note K-4 (pin X)", "aaaaaaa")).toEqual({ subject: "memory: undo aaaaaaa (keeper note K-4 (pin X))", redo: false, what: "pin X" });
    expect(revertOf("memory: undo aaaaaaa (keeper note K-4 (pin X))", "bbbbbbb")).toEqual({ subject: "memory: redo bbbbbbb (keeper note K-4 (pin X))", redo: true, what: "pin X" });
    expect(revertOf("memory: redo bbbbbbb (keeper note K-4 (pin X))", "ccccccc")).toMatchObject({ subject: "memory: undo ccccccc (keeper note K-4 (pin X))", redo: false });
  });
});

describe("E9-5e engine: a steer by message is one commit before filing, and \"that's wrong\" reverts it", { timeout: 60_000 }, () => {
  let tmp: string | undefined;
  let state: SqliteStateStore | undefined;
  afterEach(async () => {
    state?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  async function setup() {
    tmp = await mkdtemp(join(tmpdir(), "zenod-e95e-"));
    const bare = join(tmp, "origin.git");
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    const seed = join(tmp, "seed");
    await simpleGit().clone(bare, seed);
    await cp(fileURLToPath(new URL("./fixtures/tree-vault", import.meta.url)), seed, { recursive: true });
    const git = simpleGit(seed);
    await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
    await git.add(["-A"]);
    await git.commit("seed vault");
    await git.push("origin", "main");
    const repo = await VaultRepo.open({ workdir: join(tmp, "work"), remoteUrl: bare });
    state = new SqliteStateStore(":memory:");
    let modelCalls = 0;
    const llm = {
      answer: async () => { modelCalls++; return { text: "A normal answer.", readPaths: [] }; },
    } as unknown as BrainLlm;
    const engine = createEngine({ repo, llm, state });
    const remote = async () => {
      const check = join(tmp!, `check-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      await simpleGit().clone(bare, check);
      return { dir: check, log: (await simpleGit(check).log()).all.map(c => c.message) };
    };
    return { engine, remote, modelCalls: () => modelCalls, seed };
  }

  it("pin, alias, keep apart and close by message: one Keeper-note commit each, no model, nothing filed", async () => {
    const { engine, remote, modelCalls } = await setup();
    const logBefore = await readdir(join((await remote()).dir, "Log"));

    const pin = await engine.chat("pin Hair transplant", "whatsapp", { conversationKey: "jordi" });
    expect(pin.text).toBe('Memory tree: pinned "Hair transplant". It stays in working memory with this name, even when you go quiet on it (note K-1). To undo it, reply "that\'s wrong".');
    const alias = await engine.chat("hairline is the hair transplant", "whatsapp", { conversationKey: "jordi" });
    expect(alias.text).toMatch(/^Memory tree: "hairline" now means "Hair transplant"/);
    const apart = await engine.handleTasking({ text: "Launching Zenod no es Launching Epic Social", surface: "whatsapp", conversationKey: "jordi" });
    expect(apart.text).toMatch(/^Árbol de memoria: "Launching Zenod" y "Launching Epic Social" seguirán siendo temas separados/);
    expect(apart.actions.map(a => a.tool)).toEqual(["steer_memory_tree"]);
    const close = await engine.chat("sí, cierra House decision", "mcp");
    expect(close.text).toMatch(/^Árbol de memoria: he cerrado "House decision"\. Pasa a la memoria a largo plazo/);
    const again = await engine.chat("pin Hair transplant", "whatsapp", { conversationKey: "jordi" });
    expect(again.text).toBe('Memory tree: "Hair transplant" is already pinned. Nothing changed.');
    expect(modelCalls()).toBe(0);

    const { dir, log } = await remote();
    expect(log.slice(0, 4)).toEqual([
      "memory: keeper note K-4 (close House decision)",
      "memory: keeper note K-3 (keep apart Launching Zenod, Launching Epic Social)",
      "memory: keeper note K-2 (aliases Hair transplant: hairline)",
      "memory: keeper note K-1 (pin Hair transplant)",
    ]);
    const tree = await readFile(join(dir, TREE_PATH), "utf8");
    expect(parseKeeperNotes(tree).notes.map(n => [n.id, n.rule.kind, n.targets.map(t => t.name).join(", ")])).toEqual([
      ["K-1", "pinned", "Hair transplant"],
      ["K-2", "aliases", "Hair transplant"],
      ["K-3", "keep-apart", "Launching Zenod, Launching Epic Social"],
      ["K-4", "closed", "House decision"],
    ]);
    expect(parseKeeperNotes(tree).notes[0]!.why).toBe("pinned by message on whatsapp");
    expect(parseNote(await readFile(join(dir, "Projects/Hair transplant.md"), "utf8")).frontmatter).toMatchObject({ pinned: true, aliases: ["hairline"] });
    // Nothing was filed: the Log is untouched and no capture commit exists.
    expect(await readdir(join(dir, "Log"))).toEqual(logBefore);
    expect(log.some(m => /capture|filed|topic filing/.test(m))).toBe(false);
    expect((await lintTree(dir)).issues.filter(i => i.severity === "error")).toEqual([]);
  });

  it("\"that's wrong\" right after a steer reverts that one commit; again puts it back; elsewhere it is ordinary chat", async () => {
    const { engine, remote, modelCalls } = await setup();
    // With no steer before it, "that's wrong" is about the last answer: the model answers.
    const plain = await engine.chat("that's wrong", "whatsapp", { conversationKey: "jordi" });
    expect(plain.text).toBe("A normal answer.");
    expect(modelCalls()).toBe(1);

    await engine.chat("rename House decision to House", "whatsapp", { conversationKey: "jordi" });
    const treeAfterRename = await readFile(join((await remote()).dir, TREE_PATH), "utf8");
    const undo = await engine.chat("that's wrong", "whatsapp", { conversationKey: "jordi" });
    expect(undo.text).toMatch(/^Memory tree: undone: rename to House\. I reverted that one change \([0-9a-f]{7}\) with a new commit; nothing was deleted\. Say "that's wrong" again to put it back\.$/);
    expect(modelCalls()).toBe(1);

    const first = await remote();
    expect(first.log[0]).toMatch(/^memory: undo [0-9a-f]{7} \(keeper note K-1 \(rename to House\)\)$/);
    expect(first.log[1]).toBe("memory: keeper note K-1 (rename to House)");
    // Byte-identical to the vault before the rename.
    expect(await readFile(join(first.dir, TREE_PATH), "utf8")).toBe(await readFile(fileURLToPath(new URL("./fixtures/tree-vault/Tree.md", import.meta.url)), "utf8"));
    expect(await readFile(join(first.dir, "Projects/House decision.md"), "utf8")).toBe(await readFile(fileURLToPath(new URL("./fixtures/tree-vault/Projects/House decision.md", import.meta.url)), "utf8"));

    // Spanish, explicit: the undo is itself undone (the rename is back), never a force-push.
    const redo = await engine.chat("deshaz el último cambio del árbol", "whatsapp", { conversationKey: "other" });
    expect(redo.text).toMatch(/^Árbol de memoria: recuperado: rename to House\. He revertido el deshacer \([0-9a-f]{7}\)/);
    const second = await remote();
    expect(await readFile(join(second.dir, TREE_PATH), "utf8")).toBe(treeAfterRename);
    expect(second.log.length).toBe(first.log.length + 1);
    // Undo and redo alternate on the same change; subjects never nest.
    expect(second.log[0]).toMatch(/^memory: redo [0-9a-f]{7} \(keeper note K-1 \(rename to House\)\)$/);
    const third = await engine.chat("that's wrong", "whatsapp", { conversationKey: "other" });
    expect(third.text).toMatch(/^Memory tree: undone: rename to House\./);
    expect((await remote()).log[0]).toMatch(/^memory: undo [0-9a-f]{7} \(keeper note K-1 \(rename to House\)\)$/);
  });

  it("asks back on an unknown root and writes nothing; a bare \"that's wrong\" after a question is chat", async () => {
    const { engine, remote, modelCalls } = await setup();
    await engine.chat("pin Hair transplant", "whatsapp");
    const unknown = await engine.chat("pin Garden", "whatsapp");
    expect(unknown.text).toMatch(/^Memory tree: I don't have a topic called "Garden"\. Which one did you mean\? Your working topics: Launching Epic Social, Launching Zenod, Hair transplant, House decision\.$/);
    // After a question back, a bare "that's wrong" is about that answer, not an undo of the pin before it.
    expect((await engine.chat("that's wrong", "whatsapp")).text).toBe("A normal answer.");
    expect(modelCalls()).toBe(1);
    expect((await engine.chat("undo the last tree change", "whatsapp")).text).toMatch(/^Memory tree: undone: pin Hair transplant\./);
    const nothing = await engine.chat("undo the last tree change", "mcp");
    expect(nothing.text).toMatch(/^Memory tree: put back: pin Hair transplant\./);
    const taken = await engine.chat("rename House decision to Hair transplant", "whatsapp");
    expect(taken.text).toBe('Memory tree: another topic is already called "Hair transplant". Nothing changed.');
    expect(modelCalls()).toBe(1);
    expect((await remote()).log.at(-1)).toBe("seed vault");
    expect((await remote()).log).toHaveLength(4);
  });

  it("can be switched off: the message goes to the model as before", async () => {
    tmp = await mkdtemp(join(tmpdir(), "zenod-e95e-off-"));
    const bare = join(tmp, "origin.git");
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    const seed = join(tmp, "seed");
    await simpleGit().clone(bare, seed);
    await cp(fileURLToPath(new URL("./fixtures/tree-vault", import.meta.url)), seed, { recursive: true });
    const git = simpleGit(seed);
    await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
    await git.add(["-A"]);
    await git.commit("seed vault");
    await git.push("origin", "main");
    const repo = await VaultRepo.open({ workdir: join(tmp, "work"), remoteUrl: bare });
    state = new SqliteStateStore(":memory:");
    let calls = 0;
    const engine = createEngine({ repo, llm: { answer: async () => { calls++; return { text: "ok", readPaths: [] }; } } as unknown as BrainLlm, state, messageSteering: false });
    expect((await engine.chat("pin Hair transplant", "whatsapp")).text).toBe("ok");
    expect(calls).toBe(1);
  });
});
