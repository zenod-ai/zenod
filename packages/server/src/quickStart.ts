// EPIC-26 S15 (Jordi's E26-A8, "build as shown"): the tester quick start. One card in the hosted app with
// five steps that tick off by themselves from what Zenod already stores, and a score out of five:
//   1 whatsapp  — a message from WhatsApp reached this memory (a capture keyed to the WhatsApp channel);
//   2 assistant — Claude or Codex connected (an OAuth sign-in to this tenant, or a used access token);
//   3 keep      — Zenod filed a first memory (any finished capture: WhatsApp, voice note, app, assistant);
//   4 found     — an answer or search brought a memory back (the app's Chat or search, or Claude/Codex);
//   5 helper    — one helper switched on (testers start with all off, E23-A2).
// A step once ticked stays ticked (stored in the tenant's `quick-start.json`), so pruned jobs or a helper
// switched off again never take a point away. While helpers are still building for this account (U7),
// step 5 is shown as coming and the score is out of four. Nothing here changes filing, finding or replies.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT_IN_PERSONAS } from "./personaCatalog.js";
import { helpersBuilding, personaEnabled } from "./personaRunner.js";
import { personasFor } from "./personaStore.js";
import type { TaskJobStore } from "./taskJobStore.js";

export const QUICK_START_FILE = "quick-start.json";
export const QUICK_START_STEPS = ["whatsapp", "assistant", "keep", "found", "helper"] as const;
export type QuickStartStep = (typeof QUICK_START_STEPS)[number];

interface QuickStartMarks {
  ticks: Partial<Record<QuickStartStep, string>>;
  /** The assistant's own name when it signed in ("Claude", "Codex"), for the 5 of 5 line. */
  assistantName?: string;
  /** The first helper switched on, for the 5 of 5 line. */
  helperName?: string;
  hiddenAt?: string | null;
}

function read(dataDir: string): QuickStartMarks {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, QUICK_START_FILE), "utf8")) as Partial<QuickStartMarks>;
    return { ...parsed, ticks: parsed.ticks && typeof parsed.ticks === "object" ? parsed.ticks : {} };
  } catch {
    return { ticks: {} };
  }
}

function write(dataDir: string, marks: QuickStartMarks): void {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, QUICK_START_FILE);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(marks, null, 1)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

/** Tick one step for this tenant, once. Never throws: a quick start mark must not break the work it follows. */
export function markQuickStart(
  dataDir: string,
  step: QuickStartStep,
  detail: { at?: Date; assistantName?: string; helperName?: string } = {},
): void {
  try {
    const marks = read(dataDir);
    if (marks.ticks[step]) return;
    marks.ticks[step] = (detail.at ?? new Date()).toISOString();
    if (detail.assistantName && !marks.assistantName) marks.assistantName = detail.assistantName;
    if (detail.helperName && !marks.helperName) marks.helperName = detail.helperName;
    write(dataDir, marks);
  } catch (error) {
    console.warn(`[quick-start] mark ${step} not kept: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function setQuickStartHidden(dataDir: string, hidden: boolean, now = new Date()): void {
  const marks = read(dataDir);
  marks.hiddenAt = hidden ? now.toISOString() : null;
  write(dataDir, marks);
}

/** What an answer from memory brought back: true when it named at least one memory. */
export function answerFoundSomething(answer: { answered?: boolean; memories?: unknown[]; alsoCited?: unknown[] } | null | undefined): boolean {
  if (!answer || answer.answered === false) return false;
  return (answer.memories?.length ?? 0) + (answer.alsoCited?.length ?? 0) > 0;
}

/** An MCP read tool's result that brought something back (search hits or entries, one memory, a cloud). */
export function toolFoundSomething(name: string, result: unknown): boolean {
  if (!result || typeof result !== "object" || (result as { isError?: unknown }).isError) return false;
  const out = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
  if (!out || typeof out !== "object") return false;
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  switch (name) {
    case "search_memory":
      return count(out.hits) + count(out.entries) > 0;
    case "get_memory":
      return Boolean(out.entry) || typeof out.path === "string";
    case "memory_cloud":
      return count(out.nodes) > 0;
    case "ask_brain":
      return count(out.citations) + count(out.sources) + count(out.memories) > 0;
    default:
      return false;
  }
}

export const QUICK_START_READ_TOOLS = new Set(["search_memory", "get_memory", "memory_cloud", "ask_brain"]);

/** Facts read from the tenant's stores; the view adds the stored ticks. */
export interface QuickStartFacts {
  whatsappAt: number | null;
  keepAt: number | null;
  assistant: { name: string | null; at: number | null } | null;
  helper: { name: string } | null;
  helpersOpen: boolean;
}

export interface QuickStartView {
  steps: Array<{ id: QuickStartStep; done: boolean; at: string | null }>;
  score: number;
  total: 4 | 5;
  helpersOpen: boolean;
  complete: boolean;
  hidden: boolean;
  assistantName: string | null;
  helperName: string | null;
}

/** The tenant's own capture jobs: the first from WhatsApp and the first filed one, oldest first. */
export function captureFacts(store: TaskJobStore): { whatsappAt: number | null; keepAt: number | null } {
  return { whatsappAt: store.firstCaptureAt({ channel: "whatsapp" }), keepAt: store.firstCaptureAt({ done: true }) };
}

export function helperFacts(runtime: { readonly dataDir: string; readonly tenantId?: string }): Pick<QuickStartFacts, "helper" | "helpersOpen"> {
  const helpersOpen = !helpersBuilding(runtime.tenantId);
  if (!helpersOpen) return { helper: null, helpersOpen };
  const store = personasFor(runtime);
  const on = BUILT_IN_PERSONAS.find((persona) => personaEnabled(store, persona));
  return { helper: on ? { name: on.name } : null, helpersOpen };
}

/** Plain assistant names from an MCP client's self-declared name ("Claude", "claude-ai", "Codex"…). */
export function assistantLabel(clientName: string | null | undefined): string | null {
  const name = (clientName ?? "").toLowerCase();
  if (name.includes("claude")) return "Claude";
  if (name.includes("codex")) return "Codex";
  if (name.includes("chatgpt") || name.includes("openai")) return "ChatGPT";
  if (name.includes("cursor")) return "Cursor";
  return null;
}

/** Read the facts, keep any new tick for good, and return the card's view. */
export function quickStartView(dataDir: string, facts: QuickStartFacts, now = new Date()): QuickStartView {
  const marks = read(dataDir);
  const before = JSON.stringify(marks);
  const tick = (step: QuickStartStep, atMs: number | null | undefined) => {
    if (marks.ticks[step] || atMs === null || atMs === undefined) return;
    marks.ticks[step] = new Date(Math.min(atMs, now.getTime())).toISOString();
  };
  tick("whatsapp", facts.whatsappAt);
  tick("keep", facts.keepAt);
  if (facts.assistant) {
    tick("assistant", facts.assistant.at ?? now.getTime());
    if (!marks.assistantName && facts.assistant.name) marks.assistantName = facts.assistant.name;
  }
  if (facts.helper) {
    tick("helper", now.getTime());
    if (!marks.helperName) marks.helperName = facts.helper.name;
  }
  if (JSON.stringify(marks) !== before) {
    try {
      write(dataDir, marks);
    } catch (error) {
      console.warn(`[quick-start] ticks not kept: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const steps = QUICK_START_STEPS.map((id) => ({ id, done: Boolean(marks.ticks[id]), at: marks.ticks[id] ?? null }));
  const counted = facts.helpersOpen ? steps : steps.filter((step) => step.id !== "helper");
  const score = counted.filter((step) => step.done).length;
  const total = facts.helpersOpen ? 5 : 4;
  return {
    steps,
    score,
    total,
    helpersOpen: facts.helpersOpen,
    complete: score === total,
    hidden: Boolean(marks.hiddenAt),
    assistantName: marks.assistantName ?? null,
    helperName: marks.helperName ?? null,
  };
}
