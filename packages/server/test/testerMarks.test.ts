import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { looksLikeOurTest, teamEmailsFromEnv, TESTER_MARKS_FILE, TesterMarks } from "../src/testerMarks.js";

// EPIC-26 S7 round 2: our own test applications, marked by a rule or by the operator.

it("marks the word TEST, our domains, example addresses and the team list as ours", () => {
  expect(looksLikeOurTest("TEST", "How I'd use it")).toBe(true);
  expect(looksLikeOurTest("someone@gmail.com", "TEST application from the agents")).toBe(true);
  expect(looksLikeOurTest("jordi+test@gmail.com", "notes")).toBe(true);
  expect(looksLikeOurTest("me@alpha9.io", "notes")).toBe(true);
  expect(looksLikeOurTest("a@Example.com", "notes")).toBe(true);
  expect(looksLikeOurTest("x@thing.test", "notes")).toBe(true);
  expect(looksLikeOurTest("Friend@Gmail.com", "notes", teamEmailsFromEnv({ ZENOD_TEAM_EMAILS: " friend@gmail.com, b@c.de" }))).toBe(true);
});

it("leaves a stranger who wants to test Zenod as real", () => {
  expect(looksLikeOurTest("someone@gmail.com", "I'd like to test it with my voice notes")).toBe(false);
  expect(looksLikeOurTest("testa@gmail.com", "notes")).toBe(false);
});

it("lets the operator's own mark win, kept privately", () => {
  const dir = mkdtempSync(join(tmpdir(), "marks-"));
  const marks = new TesterMarks(dir);
  expect(marks.mark("someone@gmail.com")).toEqual({ test: false, byHand: false });
  marks.set("Someone@Gmail.com ", true);
  expect(marks.mark("someone@gmail.com")).toEqual({ test: true, byHand: true });
  marks.set("a@example.com", false);
  expect(marks.isTest("a@example.com")).toBe(false);
  expect(statSync(join(dir, TESTER_MARKS_FILE)).mode & 0o777).toBe(0o600);
});
