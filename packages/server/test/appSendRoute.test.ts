import { describe, expect, it } from "vitest";
import { ruleSendRoute, type SendRoute } from "zenod/send-route";
import { appSendRoute, isFollowUp } from "../src/memoryChat.js";
import { familyForms, readAs, type ReadAsIndex } from "../src/quickIndexRead.js";

// EPIC-14 S29 round 2: the shapes of the chat that failed on 10 Nov, on made-up words only.
// A question, then "I meant …": the model read the correction as a job on the memory, the app asked
// "keep it, or do it as a job?", and the desk found nothing to re-file.
const unsure = (message: string): SendRoute => ({ action: "unsure", keep: null, question: null, job: message, by: "model" });

describe("the app's Send after the shared decision (E14-S29 round 2)", () => {
  it("answers a follow-up as the question before it, corrected, never as a job, a keep or a talk", () => {
    const message = "I meant my preferences in buying gardening";
    expect(isFollowUp(message)).toBe(true);
    const route = appSendRoute(unsure(message), message, "What are my preferences?");
    expect(route).toEqual({ action: "answer", keep: null, question: "What are my preferences? I mean: my preferences in buying gardening", by: "model" });
    for (const shared of [ruleSendRoute(message), { ...unsure(message), action: "job" as const }, { action: "talk" as const, keep: null, question: null, talk: message, by: "model" as const }]) {
      expect(appSendRoute(shared, message, "What are my preferences?").action).toBe("answer");
    }
  });

  it("answers a follow-up with no question before it on its own words", () => {
    expect(appSendRoute(unsure("no, I meant the boat"), "no, I meant the boat", null)).toMatchObject({ action: "answer", question: "the boat" });
    expect(isFollowUp("Sorry, what I meant is the boat")).toBe(true);
    expect(isFollowUp("me refería a la barca")).toBe(true);
    expect(isFollowUp("I meanwhile bought a boat")).toBe(false);
    expect(isFollowUp("Remember I meant to call Ana")).toBe(false);
  });

  it("drops a job only the model saw when the words name no topic, page or note", () => {
    const question = "What did I decide about the boat engine";
    expect(appSendRoute(unsure(question), question, null)).toMatchObject({ action: "answer", question });
    // Words about the memory's own items still ask "keep it, or do it as a job?".
    const filing = "my boat notes are all over the place";
    expect(appSendRoute(unsure(filing), filing, null).action).toBe("unsure");
    // A job both agree on is untouched.
    const job = "move my notes about the boat under Hobbies";
    const both: SendRoute = { action: "job", keep: null, question: null, job, by: "model" };
    expect(appSendRoute(both, job, null)).toBe(both);
  });

  it("leaves keeps, answers and talks it did not change as they were", () => {
    for (const route of [ruleSendRoute("Ana's birthday is May 3"), ruleSendRoute("when is Ana's birthday?"), ruleSendRoute("what do you think about the boat?")]) {
      expect(appSendRoute(route, "x", "y")).toBe(route);
    }
  });
});

describe("a word of a place's family reads as that place (E14-S29 round 2)", () => {
  const place = (path: string, title: string, memories = 12): ReadAsIndex["places"][number] =>
    ({ path, title, lineage: [title], memory: "working", summary: "", names: [], pages: 1, memories, week: 0, lastTouched: null });
  const GARDENING = place("Areas/Gardening.md", "Gardening");
  const BOATS = place("Areas/Boats.md", "Boats");
  const INDEX: ReadAsIndex = { places: [GARDENING, BOATS, place("Notes/Trading.md", "Trading", 1)] };

  it("gives the name, its -ing made -e and its singular", () => {
    expect(familyForms("housing")).toEqual(["housing", "house"]);
    expect(familyForms("gardening")).toEqual(["gardening", "gardene"]);
    expect(familyForms("boats")).toEqual(["boats"]);
    expect(familyForms("travels")).toEqual(["travels", "travel"]);
  });

  it("reads household as Housing, and a plural as its place, shown so it can be corrected", () => {
    const HOUSING = place("Areas/Housing.md", "Housing", 19);
    const readings = readAs("I meant my preferences in buying household", { places: [HOUSING] });
    expect(readings.map((r) => [r.phrase, r.path, r.by])).toEqual([["household", "Areas/Housing.md", "word"]]);
    expect(readAs("the houses we saw", { places: [HOUSING] }).map((r) => r.path)).toEqual(["Areas/Housing.md"]);
  });

  it("never for a place he rarely adds to, a word that only shares a short start, or a word he corrected away", () => {
    expect(readAs("trades this week", INDEX)).toEqual([]);
    expect(readAs("a garden party", INDEX)).toEqual([]);
    expect(readAs("household chores", { places: [place("Areas/Housing.md", "Housing")], corrections: { household: { phrase: "household", path: null, at: "2026-11-10T00:00:00Z" } } })).toEqual([]);
  });
});
