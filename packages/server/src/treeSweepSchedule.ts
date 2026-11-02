
/**
 * When the weekly tree sweep runs (EPIC-9 E9-2d). Each tenant gets one sweep per
 * week, keyed by the Sunday that starts the week, run at the first per-tenant
 * monitor tick inside the off-peak window (02:00–06:00 UTC, i.e. early morning in
 * Europe). A tenant whose runtime was not awake on Sunday night is swept the next
 * night it is, so a restart never skips a week and never runs at peak time.
 * The idempotency key on the durable job makes the "once per week" survive restarts.
 */
export const TREE_SWEEP_WEEKDAY_UTC = 0; // Sunday
export const TREE_SWEEP_WINDOW_START_HOUR_UTC = 2;
export const TREE_SWEEP_WINDOW_END_HOUR_UTC = 6;
export const TREE_SWEEP_KEY_PREFIX = "tree-sweep:week:";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function utcMidnight(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Start of the current sweep week: the latest Sunday 02:00 UTC at or before `now`. */
export function treeSweepWeekStart(now: number): number {
  const midnight = utcMidnight(now);
  const weekday = new Date(midnight).getUTCDay();
  let start = midnight - ((weekday - TREE_SWEEP_WEEKDAY_UTC + 7) % 7) * DAY_MS + TREE_SWEEP_WINDOW_START_HOUR_UTC * HOUR_MS;
  if (start > now) start -= 7 * DAY_MS;
  return start;
}

/** Idempotency key of this week's scheduled sweep, e.g. `tree-sweep:week:2026-11-08`. */
export function treeSweepWeekKey(now: number): string {
  return `${TREE_SWEEP_KEY_PREFIX}${new Date(treeSweepWeekStart(now)).toISOString().slice(0, 10)}`;
}

export function inTreeSweepWindow(now: number): boolean {
  const hour = new Date(now).getUTCHours();
  return hour >= TREE_SWEEP_WINDOW_START_HOUR_UTC && hour < TREE_SWEEP_WINDOW_END_HOUR_UTC;
}

/**
 * Next time the sweep will run: the next off-peak window start (or now, inside a
 * window) when this week's sweep has not run yet, otherwise next week's Sunday 02:00 UTC.
 */
export function nextTreeSweepAt(now: number, ranThisWeek: boolean): Date {
  if (ranThisWeek) return new Date(treeSweepWeekStart(now) + 7 * DAY_MS);
  if (inTreeSweepWindow(now)) return new Date(now);
  const today = utcMidnight(now) + TREE_SWEEP_WINDOW_START_HOUR_UTC * HOUR_MS;
  return new Date(today > now ? today : today + DAY_MS);
}

export const TREE_SWEEP_SCHEDULE_TEXT = "weekly, from Sunday 02:00 UTC, in the first 02:00–06:00 UTC off-peak window the tenant is awake";
