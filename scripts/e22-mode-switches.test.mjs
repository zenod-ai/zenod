import test from "node:test";
import assert from "node:assert/strict";
import { analyse, countFromAccessLog, examples, MIN_SWITCHES, readJsonl, score, shape } from "./e22-mode-switches.mjs";

// A stand-in for the rules: questions are looked up, the rest kept.
const route = (message) => ({ action: /\?\s*$/.test(message) ? "answer" : "keep" });

test("counts switches from the proxy log: POST memory-switch answered 202, since a time", () => {
  const lines = [
    { RequestMethod: "POST", RequestPath: "/api/console/memory-switch", DownstreamStatus: 202, StartUTC: "2026-11-09T21:00:00Z" },
    { RequestMethod: "POST", RequestPath: "/api/console/memory-switch", DownstreamStatus: 202, StartUTC: "2026-11-08T21:00:00Z" },
    { RequestMethod: "POST", RequestPath: "/api/console/memory-switch", DownstreamStatus: 401, StartUTC: "2026-11-09T21:00:00Z" },
    { RequestMethod: "POST", RequestPath: "/api/console/memory-send/stream", DownstreamStatus: 200, StartUTC: "2026-11-09T21:00:00Z" },
  ];
  assert.equal(countFromAccessLog(lines), 2);
  assert.equal(countFromAccessLog(lines, "2026-11-09T19:46:55Z"), 1);
});

test("reads JSON lines and skips broken ones", () => {
  assert.deepEqual(readJsonl('{"a":1}\nnot json\n\n{"a":2}\n'), [{ a: 1 }, { a: 2 }]);
});

test("the report groups switches and lists those today's rules still get wrong", () => {
  const switches = [
    { at: "t", from: "answer", by: "rules", to: "talk", message: "should I move to Lisbon?" },
    { at: "t", from: "answer", by: "rules", to: "talk", message: "should I sell the flat?" },
    { at: "t", from: "keep", by: "model", to: "lookup", message: "when is Ana's birthday?" },
  ];
  const report = analyse(switches, route);
  assert.deepEqual(report.matrix, { "answer -> talk": 2, "keep -> lookup": 1 });
  assert.deepEqual(report.by, { rules: 2, model: 1 });
  assert.equal(report.stillWrong.length, 2);
  assert.equal(report.patterns["talk · opener=should i"], 2);
  assert.ok(MIN_SWITCHES >= 15);
});

test("switches become labelled examples, and sets are scored by the rules", () => {
  const rows = examples([{ to: "job", message: "split these notes" }, { to: "lookup", message: "who is Ana?" }]);
  assert.deepEqual(rows.map((row) => row.expect), [["job", "unsure"], ["answer"]]);
  assert.deepEqual(score(rows, route), { right: 1, of: 2, wrong: [{ id: "switch-0", want: ["job", "unsure"], got: "keep" }] });
  assert.deepEqual(shape("You know? It is long"), { opener: "you know", endsOnQuestion: false, spokenTag: true, length: "short" });
});
