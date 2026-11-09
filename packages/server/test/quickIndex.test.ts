import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { QuickIndexBase, QuickIndexPlace } from "zenod";
import {
  acceptName,
  emptyQuickIndexState,
  QUICK_INDEX_DAY_CAP_USD,
  QuickIndexStore,
  quickIndexView,
  updateQuickIndex,
  type QuickIndexModel,
} from "../src/quickIndex.js";

// EPIC-14 S28: the quick index's names pass, its caps and what the app is shown.
function place(path: string, title: string, captures: Array<[string, string]>, extra: Partial<QuickIndexPlace> = {}): QuickIndexPlace {
  return {
    path, title, memory: "working", lineage: [title], root: true, summary: `${title} summary`, aliases: [], pages: 1,
    memories: captures.length, week: captures.filter(([key]) => key >= "2026-11-03").length, lastTouched: captures[0]?.[0].slice(0, 10) ?? null,
    captureKeys: captures.map(([key]) => key),
    captures: captures.map(([key, text]) => ({ key, date: key.slice(0, 10), text })),
    ...extra,
  };
}

const MOVE = place("Projects/Move.md", "Moving to Valencia", [["2026-11-08#^e-aaaaaa", "We saw the flat in Ruzafa again, the flat is perfect."]], { aliases: ["The move"] });
const BOAT = place("Projects/Boat.md", "Boat", [["2026-10-01#^e-bbbbbb", "The Laia needs a new engine."]]);
const base = (places: QuickIndexPlace[] = [MOVE, BOAT]): QuickIndexBase => ({ places, weekFrom: "2026-11-03" });

function model(replies: string[], costUsd = 0.0003): QuickIndexModel & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    complete: async (input) => {
      prompts.push(input.prompt);
      return { text: replies.shift() ?? "{\"names\":[]}", inputTokens: 1500, outputTokens: 150, costUsd };
    },
  };
}

const NOON = Date.parse("2026-11-09T12:00:00Z");
const NIGHT = Date.parse("2026-11-10T04:30:00Z");

describe("quick index names (E14-S28)", () => {
  it("keeps only short, new names written word for word in the person's words", () => {
    const texts = MOVE.captures.map((c) => c.text);
    expect(acceptName("the flat", MOVE, texts, MOVE.aliases)).toBe("the flat");
    expect(acceptName("“The Flat.”", MOVE, texts, MOVE.aliases)).toBe("The Flat");
    expect(acceptName("the apartment", MOVE, texts, [])).toBeNull(); // not in his words
    expect(acceptName("fla", MOVE, texts, [])).toBeNull(); // only part of a word
    expect(acceptName("Moving to Valencia", MOVE, texts, [])).toBeNull(); // its own name
    expect(acceptName("the move", MOVE, ["the move is on"], MOVE.aliases)).toBeNull(); // already an alias
    expect(acceptName("this", MOVE, ["this flat"], [])).toBeNull(); // generic
    expect(acceptName("AC2334D9F38222011F8F", MOVE, ["note AC2334D9F38222011F8F"], [])).toBeNull(); // a file id
    expect(acceptName("we saw the flat in ruzafa again the flat", MOVE, texts, [])).toBeNull(); // too long
  });

  it("first build reads every place once, then a filing reads only the new note, then the nightly pass runs once", async () => {
    // Fullest places first, then by path: the boat is place 1, the move place 2.
    const first = model(['{"names":[{"place":2,"name":"the flat"},{"place":1,"name":"the Laia"},{"place":1,"name":"a yacht"},{"place":9,"name":"x"}]}']);
    const one = await updateQuickIndex(base(), emptyQuickIndexState(), { model: first, now: NOON });
    expect(one.update).toMatchObject({ pass: "first", calls: 1, names: 2 });
    expect(first.prompts[0]).toContain("Place 2: Moving to Valencia");
    expect(first.prompts[0]).toContain("Already known as: The move");
    expect(one.state.nicknames["Projects/Move.md"]).toEqual([{ name: "the flat", from: "2026-11-08#^e-aaaaaa", at: "2026-11-09T12:00:00.000Z" }]);
    expect(one.state.calls).toEqual([{ at: "2026-11-09T12:00:00.000Z", pass: "first", places: 2, inputTokens: 1500, outputTokens: 150, costUsd: 0.0003, ok: true, names: 2 }]);

    // Nothing new: no call.
    const idle = model([]);
    const two = await updateQuickIndex(base(), one.state, { model: idle, now: NOON + 300_000 });
    expect(two.update).toMatchObject({ pass: null, calls: 0 });

    // A new note on the move: one call, only that place and only the new words.
    const filed = place("Projects/Move.md", "Moving to Valencia", [["2026-11-09#^e-ffffff", "Signed for the piso today."], ["2026-11-08#^e-aaaaaa", "We saw the flat in Ruzafa again."]], { aliases: ["The move"] });
    const filing = model(['{"names":[{"place":1,"name":"the piso"},{"place":1,"name":"piso"}]}']);
    const three = await updateQuickIndex(base([filed, BOAT]), two.state, { model: filing, now: NOON + 600_000 });
    expect(three.update).toMatchObject({ pass: "filing", calls: 1, names: 1 });
    expect(filing.prompts[0]).toContain("Signed for the piso today.");
    expect(filing.prompts[0]).not.toContain("Ruzafa");
    expect(filing.prompts[0]).not.toContain("Boat");
    expect(three.state.nicknames["Projects/Move.md"]!.map((n) => n.name)).toEqual(["the flat", "the piso"]);

    // The nightly pass: once a night, this week's places only.
    const nightly = model(['{"names":[]}']);
    const four = await updateQuickIndex(base([filed, BOAT]), three.state, { model: nightly, now: NIGHT });
    expect(four.update).toMatchObject({ pass: "nightly", calls: 1 });
    expect(nightly.prompts[0]).toContain("Moving to Valencia");
    expect(nightly.prompts[0]).not.toContain("Laia");
    const again = await updateQuickIndex(base([filed, BOAT]), four.state, { model: model([]), now: NIGHT + 300_000 });
    expect(again.update.pass).toBeNull();
  });

  it("builds without a model, stops at the day cap and the allowance, and drops names of places that are gone", async () => {
    const without = await updateQuickIndex(base(), emptyQuickIndexState(), { model: null, now: NOON });
    expect(without.update).toMatchObject({ pass: "first", calls: 0 });
    expect(without.state.firstBuiltAt).toBe("2026-11-09T12:00:00.000Z");

    const spent = { ...without.state, nicknames: { "Gone.md": [{ name: "old", from: "", at: "" }] }, calls: [{ at: "2026-11-09T11:00:00.000Z", pass: "filing" as const, places: 1, inputTokens: 1, outputTokens: 1, costUsd: QUICK_INDEX_DAY_CAP_USD, ok: true, names: 0 }] };
    const newNote = place("Projects/Boat.md", "Boat", [["2026-11-09#^e-999999", "The Laia again."]]);
    const capped = model(['{"names":[{"place":1,"name":"the Laia"}]}']);
    const result = await updateQuickIndex(base([MOVE, newNote]), spent, { model: capped, now: NOON });
    expect(result.update).toMatchObject({ pass: "filing", calls: 0 });
    expect(capped.prompts).toEqual([]);
    expect(result.state.nicknames["Gone.md"]).toBeUndefined();

    const blocked = model([]);
    await updateQuickIndex(base(), emptyQuickIndexState(), { model: blocked, blocked: () => true, now: NOON });
    expect(blocked.prompts).toEqual([]);
  });

  it("a failed call is logged at no cost and never repeated by the next filing tick", async () => {
    const failing: QuickIndexModel = { complete: async () => { throw new Error("deepseek 500"); } };
    const one = await updateQuickIndex(base(), { ...emptyQuickIndexState(), firstBuiltAt: "2026-11-01T00:00:00.000Z" }, { model: failing, now: NOON });
    expect(one.update).toMatchObject({ pass: "filing", calls: 1, costUsd: 0 });
    expect(one.state.calls[0]).toMatchObject({ ok: false, costUsd: 0 });
    const two = await updateQuickIndex(base(), one.state, { model: failing, now: NOON + 300_000 });
    expect(two.update.pass).toBeNull();
  });

  it("the view shows names, this week and cost per day, and never the person's words", async () => {
    const { state } = await updateQuickIndex(base(), emptyQuickIndexState(), { model: model(['{"names":[{"place":2,"name":"the flat"}]}'], 0.004), now: NOON });
    const view = quickIndexView(base(), state, NOON);
    expect(view.places[0]).toMatchObject({ title: "Moving to Valencia", names: ["The move", "the flat"], memories: 1, week: 1 });
    expect(view.thisWeek.map((p) => p.title)).toEqual(["Moving to Valencia"]);
    expect(view.totals).toEqual({ places: 2, named: 1, names: 2, thisWeek: 1 });
    expect(view.cost).toMatchObject({ todayUsd: 0.004, firstBuildUsd: 0.004, calls: 1 });
    expect(view.cost.perDayUsd).toHaveLength(7);
    expect(JSON.stringify(view)).not.toContain("Ruzafa");
  });
});

describe("quick index store", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("reads an empty state when there is no file, and reads back what it wrote", () => {
    const dir = mkdtempSync(join(tmpdir(), "zenod-qi-"));
    dirs.push(dir);
    const store = new QuickIndexStore(dir);
    expect(store.read()).toEqual(emptyQuickIndexState());
    store.write({ ...emptyQuickIndexState(), firstBuiltAt: "x" });
    expect(store.read().firstBuiltAt).toBe("x");
  });
});
