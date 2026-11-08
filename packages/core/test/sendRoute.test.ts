import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guardSendRoute, isQuestionClause, parseSendRoute, ruleSendRoute, sendRoutePrompt, looksLikeDeskJob } from "../src/llm/sendRoute.js";

// EPIC-16 E16-B1: one Send button. Zenod decides from the content whether to keep, answer, or both,
// and a question is never kept.
type Fixture = { messages: Array<{ message: string; expect: "keep" | "answer" | "both" }> };
const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Fixture;

describe("send route rules (E16-B1)", () => {
  it.each(["send-route-40.json", "send-route-heldout-40.json"])("decides at least 9 in 10 of the 40 real-style messages in %s right, and never keeps a question", (name) => {
    const fixture = load(name);
    expect(fixture.messages).toHaveLength(40);
    const wrong: string[] = [];
    for (const { message, expect: want } of fixture.messages) {
      const route = ruleSendRoute(message);
      if (route.action !== want) wrong.push(`${want} → ${route.action}: ${message}`);
      if (want === "answer") expect(route.keep, message).toBeNull();
      if (route.keep) expect(isQuestionClause(route.keep), route.keep).toBe(false);
    }
    expect(wrong.length, wrong.join("\n")).toBeLessThanOrEqual(4);
  });

  it("splits a mixed message into the part to keep and the question", () => {
    expect(ruleSendRoute("Remember Ana's new phone is 699 120 334, and what did I say about her birthday?")).toEqual({
      action: "both", keep: "Ana's new phone is 699 120 334", question: "what did I say about her birthday?", by: "rules",
    });
    expect(ruleSendRoute("Note: the spare key is under the blue pot.")).toMatchObject({ action: "keep", keep: "the spare key is under the blue pot." });
    expect(ruleSendRoute("thanks!")).toMatchObject({ action: "answer", keep: null });
  });
});

describe("parseSendRoute guard (E16-B1)", () => {
  const msg = "Who is our plumber?";
  it("reads the model's JSON", () => {
    expect(parseSendRoute('{"keep": "", "ask": "Who is our plumber?"}', msg)).toEqual({ action: "answer", keep: null, question: msg, by: "model" });
    const mixed = "Remember the gate code is 4411. Where did I put the spare key?";
    expect(parseSendRoute('```json\n{"keep": "the gate code is 4411", "ask": "Where did I put the spare key?"}\n```', mixed))
      .toMatchObject({ action: "both", keep: "the gate code is 4411", question: "Where did I put the spare key?" });
  });

  it("never keeps a question, even when the model says so", () => {
    expect(parseSendRoute('{"keep": "Who is our plumber?", "ask": ""}', msg)).toMatchObject({ action: "answer", keep: null, question: msg });
    expect(parseSendRoute('{"keep": "our plumber", "ask": ""}', msg)).toMatchObject({ action: "answer", keep: null });
    expect(parseSendRoute('{"keep": "Tell me what Marta said", "ask": ""}', "Tell me what Marta said")).toMatchObject({ keep: null });
    const mixed = "Where is the key? The shed is green.";
    expect(parseSendRoute('{"keep": "Where is the key? The shed is green.", "ask": ""}', mixed)).toMatchObject({ action: "both", keep: "The shed is green.", question: "Where is the key?" });
  });

  it("never keeps words the person did not send", () => {
    const told = "Dentist moved to Tuesday at 10.";
    expect(parseSendRoute('{"keep": "Your dentist appointment was rescheduled by the clinic", "ask": ""}', told))
      .toMatchObject({ action: "keep", keep: told });
  });

  it("answers a question mark the model overlooked, and returns null on a slip", () => {
    expect(parseSendRoute('{"keep": "Paid the car insurance, 412 euros.", "ask": ""}', "Paid the car insurance, 412 euros. How much did I pay last year?"))
      .toMatchObject({ action: "both", question: "How much did I pay last year?" });
    expect(parseSendRoute("I think this is a question", msg)).toBeNull();
    expect(parseSendRoute("{not json", msg)).toBeNull();
  });

  it("a route with nothing to do answers the message", () => {
    expect(guardSendRoute({ action: "keep", keep: null, question: null, by: "model" }, "hello")).toMatchObject({ action: "answer", question: "hello" });
    expect(sendRoutePrompt("x").prompt).toBe("MESSAGE\nx");
  });
});

describe("the memory desk's job outcome (EPIC-14 S3)", () => {
  const JOBS = [
    "Idealista and Poly-Maker are tangled, they are two separate things, please split them",
    "move the boiler notes under House",
    "Can you merge the Flat and Apartment pages?",
    "rename the Garden topic to Allotment",
    "my cabin notes got mixed up with the boat",
    "separa los temas de Idealista y Poly-Maker",
  ];
  const NOT_JOBS = [
    "Can you move the couch on Saturday",
    "We split the bill with Ana",
    "Rename the company to Brightwater next year",
    "what did I say about the boat?",
    "remember to clean up the garage",
  ];

  it("the plain rules read a request to reorganise the memory, never a chore or a question", () => {
    for (const message of JOBS) expect(looksLikeDeskJob(message), message).toBe(true);
    for (const message of NOT_JOBS) expect(looksLikeDeskJob(message), message).toBe(false);
  });

  it("runs a job only when the model and the rules agree, asks when one of them is unsure", () => {
    const message = JOBS[0]!;
    expect(parseSendRoute(JSON.stringify({ keep: "", ask: "", job: message }), message)).toEqual({ action: "job", keep: null, question: null, job: message, by: "model" });
    expect(parseSendRoute(JSON.stringify({ keep: message, ask: "" }), message)).toMatchObject({ action: "unsure", keep: null, job: message });
    expect(parseSendRoute(JSON.stringify({ keep: "", ask: "", job: "tidy" }), "We split the bill with Ana")).toMatchObject({ action: "unsure", keep: null, question: null });
    expect(ruleSendRoute(message)).toMatchObject({ action: "unsure", by: "rules" });
    expect(ruleSendRoute("We split the bill with Ana")).toMatchObject({ action: "keep" });
    expect(sendRoutePrompt(message).system).toContain("job:");
  });
});
