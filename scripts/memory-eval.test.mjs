// E15-Q2: the memory suite's stand-in model files deterministically onto the page Zenod offers.
import assert from "node:assert/strict";
import test from "node:test";
import { StandInModel, sentences } from "./memory-eval/organiser.mjs";

const pageIndex = [
  { path: "Projects/Boat repair.md", title: "Boat repair", summary: "Deciding on a boat repair: hull, yard and quotes.", type: "project", tags: [] },
  { path: "Notes/Home/Spare key.md", title: "Spare key", summary: "Where the spare house key is.", type: "note", tags: [] },
];

test("each sentence goes to the page sharing its rare words, or asks for a new page", async () => {
  const model = new StandInModel();
  const text = "The Porto yard quoted a hull repair at 4,200 euros. The spare house key moved to the shed. I started cello lessons on Tuesdays.";
  const out = await model.classify({ content: text, hints: [], pageIndex, tagVocabulary: [] });
  assert.deepEqual(out.topics.map((t) => t.pages[0].path), ["Projects/Boat repair.md", "Notes/Home/Spare key.md", "Notes/Started cello lessons tuesdays.md"]);
  for (const t of out.topics) for (const q of t.evidenceQuotes) assert.ok(text.includes(q));
  assert.equal(sentences(text).length, 3);
});

test("the answer stand-in records what it read and declines", async () => {
  const model = new StandInModel();
  assert.equal(await model.streamMemoryChat({ system: "s", prompt: "memory text" }), "NO_ANSWER");
  assert.equal(model.lastAnswerPrompt, "memory text");
});
