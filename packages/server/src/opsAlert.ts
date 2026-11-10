// EPIC-24 M2: one log line per failure a user would notice, read by the health page's probe on VPS3
// (docs/health/s1-live/probe.py), which turns its row red and alerts the team within 15 minutes.
// Format: `[ops-alert] <kind> <reason> [key=value ...]`. Kinds and reasons are fixed words; values are
// counts, minutes, error class names and route templates only: never message text, emails, ids or tokens.

export type OpsAlertKind = "save" | "answer" | "signin" | "app" | "helper";

const WORD = /[^A-Za-z0-9_.:/-]/g;

/** A value safe for the line: letters, digits and `_.:/-` only, at most 60 characters. */
export function opsWord(value: unknown): string {
  return String(value ?? "").replace(WORD, "_").slice(0, 60) || "_";
}

export function opsAlertLine(kind: OpsAlertKind, reason: string, fields: Record<string, string | number | undefined> = {}): string {
  const extra = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => ` ${opsWord(k)}=${opsWord(v)}`)
    .join("");
  return `[ops-alert] ${kind} ${opsWord(reason)}${extra}`;
}

export function opsAlert(kind: OpsAlertKind, reason: string, fields: Record<string, string | number | undefined> = {}): void {
  console.warn(opsAlertLine(kind, reason, fields));
}
