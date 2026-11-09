import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MEMORY_CHAT_MAX_QUESTION_CHARS } from "./memoryChat.js";

/**
 * EPIC-22 E22-L3: every tap on a reply's mode label that redoes a message another way is a sign
 * Zenod's pick was wrong. The app records each one here, in the person's own data folder: the
 * message, what Zenod picked (the Send decision's action and whether rules or the model decided),
 * and the mode the person switched to. Nothing leaves the tenant's data volume; the tuning script
 * (scripts/e22-mode-switches.mjs) reads this file on the server to tune the pick.
 */

export const MODE_SWITCHES_FILE = "mode-switches.jsonl";

const PICKS = ["keep", "answer", "both", "job", "unsure", "talk"] as const;
const MODES = ["keep", "lookup", "talk", "job"] as const;

export type ModeSwitchPick = (typeof PICKS)[number];
export type ModeSwitchMode = (typeof MODES)[number];

export interface ModeSwitch {
  at: string;
  message: string;
  /** What Zenod picked for the message. */
  from: ModeSwitchPick;
  /** Who picked it: the plain rules, or the model with the rules' agreement. */
  by: "rules" | "model";
  /** The mode the person switched to. */
  to: ModeSwitchMode;
}

/** Parse the app's switch body; null when it is not a switch of a message Zenod picked. */
export function parseModeSwitch(body: unknown, at: Date): ModeSwitch | null {
  const value = (body ?? {}) as Record<string, unknown>;
  const message = typeof value.message === "string" ? value.message.trim() : "";
  if (!message || message.length > MEMORY_CHAT_MAX_QUESTION_CHARS) return null;
  const from = PICKS.find((pick) => pick === value.from);
  const to = MODES.find((mode) => mode === value.to);
  if (!from || !to) return null;
  // Picking the mode Zenod already chose is a redo, not a switch.
  if ((from === "answer" && to === "lookup") || from === to) return null;
  const by = value.by === "model" ? "model" : "rules";
  return { at: at.toISOString(), message, from, by, to };
}

export function modeSwitchesPath(dataDir: string): string {
  return join(dataDir, MODE_SWITCHES_FILE);
}

export function recordModeSwitch(dataDir: string, record: ModeSwitch): void {
  const path = modeSwitchesPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

/** The switches kept so far, oldest first; unreadable lines are skipped. */
export function readModeSwitches(dataDir: string): ModeSwitch[] {
  const path = modeSwitchesPath(dataDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ModeSwitch];
      } catch {
        return [];
      }
    });
}
