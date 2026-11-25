// EPIC-7 E7-S38 (Jordi's WhatsApp voice note 2026-11-25 13:53Z, Log/2026-11-25.md#^e-64c39b: "I'm receiving so many
// whatsapps that I think the briefings are getting a little bit lost, we should be extremely ecological with the
// whatsapps we send"): a caller of `notify` may mark a message `urgency: "batch"`. It is then kept here, not sent, and
// every batch window (default 3 h, never inside quiet hours) the tenant gets ONE message holding all of them. Briefings,
// real alarms and replies stay `now` (the default), so they still arrive one by one and are no longer buried.
//
// The queue is a small JSON file on the data volume, written atomically, so a deploy or crash never loses an item: an
// item leaves the file only after its batch was sent, and a failed send puts the items back.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PHYLAX_NOTIFY_BATCH_FILE = "notify-batch.json";
export const DEFAULT_NOTIFY_BATCH_MINUTES = 180;
/** Local hours [from, to) in which no batch goes out (the next one after `to` carries it). */
export const DEFAULT_NOTIFY_BATCH_QUIET: [number, number] = [22, 8];
export const DEFAULT_NOTIFY_BATCH_TZ = "America/Mexico_City";
/** A batch longer than this lists the rest as a count (WhatsApp allows more; a phone screen does not). */
export const NOTIFY_BATCH_MAX_CHARS = 6000;

export interface NotifyBatchItem {
  text: string;
  at: number;
}

interface BatchState {
  tenants: Record<string, NotifyBatchItem[]>;
}

export interface NotifyBatchOptions {
  windowMs?: number;
  quietHours?: [number, number];
  timeZone?: string;
}

/** Read the batch window, quiet hours and zone from the environment; bad values fall back to the defaults. */
export function notifyBatchOptionsFromEnv(env: NodeJS.ProcessEnv): Required<NotifyBatchOptions> {
  const minutes = Number(env.PHYLAX_NOTIFY_BATCH_MINUTES);
  const quiet = /^(\d{1,2})-(\d{1,2})$/.exec(env.PHYLAX_NOTIFY_BATCH_QUIET?.trim() ?? "");
  const from = quiet ? Number(quiet[1]) : NaN;
  const to = quiet ? Number(quiet[2]) : NaN;
  const zone = env.PHYLAX_NOTIFY_BATCH_TZ?.trim() || DEFAULT_NOTIFY_BATCH_TZ;
  let timeZone = DEFAULT_NOTIFY_BATCH_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    timeZone = zone;
  } catch {
    // keep the default zone
  }
  return {
    windowMs: (Number.isFinite(minutes) && minutes >= 5 ? minutes : DEFAULT_NOTIFY_BATCH_MINUTES) * 60_000,
    quietHours: env.PHYLAX_NOTIFY_BATCH_QUIET?.trim() === "off"
      ? [0, 0]
      : from >= 0 && from < 24 && to >= 0 && to < 24 ? [from, to] : DEFAULT_NOTIFY_BATCH_QUIET,
    timeZone,
  };
}

/** PURE: the local hour of `now` in `timeZone`. */
export function localHour(now: number, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(now));
  return Number(hour) % 24;
}

/** PURE: is this local hour inside [from, to)? A range over midnight (22-8) wraps; [x, x] is never quiet. */
export function inQuietHours(hour: number, [from, to]: [number, number]): boolean {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** PURE: the one message a batch sends: a count line, then each item whole, oldest first. */
export function composeNotifyBatch(items: NotifyBatchItem[], maxChars = NOTIFY_BATCH_MAX_CHARS): string {
  const head = items.length === 1 ? "1 update, held so it would not interrupt you:" : `${items.length} updates, held so they would not interrupt you:`;
  const parts: string[] = [head];
  let used = head.length;
  let shown = 0;
  for (const item of items) {
    const part = `${shown + 1}. ${item.text.trim()}`;
    if (shown > 0 && used + part.length + 2 > maxChars) break;
    parts.push(part);
    used += part.length + 2;
    shown += 1;
  }
  if (shown < items.length) parts.push(`+ ${items.length - shown} more on your team page.`);
  return parts.join("\n\n");
}

export class PhylaxNotifyBatch {
  private readonly path: string;
  readonly windowMs: number;
  readonly quietHours: [number, number];
  readonly timeZone: string;

  constructor(private readonly dataDir: string, options: NotifyBatchOptions = {}) {
    this.path = join(dataDir, PHYLAX_NOTIFY_BATCH_FILE);
    this.windowMs = options.windowMs ?? DEFAULT_NOTIFY_BATCH_MINUTES * 60_000;
    this.quietHours = options.quietHours ?? DEFAULT_NOTIFY_BATCH_QUIET;
    this.timeZone = options.timeZone ?? DEFAULT_NOTIFY_BATCH_TZ;
  }

  private read(): BatchState {
    if (!existsSync(this.path)) return { tenants: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<BatchState>;
      return { tenants: parsed.tenants && typeof parsed.tenants === "object" ? parsed.tenants : {} };
    } catch {
      return { tenants: {} };
    }
  }

  private write(state: BatchState): void {
    mkdirSync(this.dataDir, { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temp, this.path);
  }

  /** Keep one message for the tenant's next batch; returns how many wait and when the batch is due. */
  add(tenantId: string, text: string, now = Date.now()): { waiting: number; dueAt: number } {
    const state = this.read();
    const items = state.tenants[tenantId] ?? [];
    items.push({ text, at: now });
    state.tenants[tenantId] = items;
    this.write(state);
    return { waiting: items.length, dueAt: items[0]!.at + this.windowMs };
  }

  pending(tenantId: string): NotifyBatchItem[] {
    return [...(this.read().tenants[tenantId] ?? [])];
  }

  /** Tenants whose oldest held message has waited a full window, unless it is quiet hours now. */
  due(now = Date.now()): string[] {
    if (inQuietHours(localHour(now, this.timeZone), this.quietHours)) return [];
    const state = this.read();
    return Object.entries(state.tenants)
      .filter(([, items]) => items.length > 0 && now - items[0]!.at >= this.windowMs)
      .map(([tenantId]) => tenantId);
  }

  /** Take the tenant's held messages out (send them, then `restore` them if the send failed). */
  take(tenantId: string): NotifyBatchItem[] {
    const state = this.read();
    const items = state.tenants[tenantId] ?? [];
    if (items.length === 0) return [];
    delete state.tenants[tenantId];
    this.write(state);
    return items;
  }

  /** Put messages back in front of anything held since (a failed batch send). */
  restore(tenantId: string, items: NotifyBatchItem[]): void {
    if (items.length === 0) return;
    const state = this.read();
    state.tenants[tenantId] = [...items, ...(state.tenants[tenantId] ?? [])];
    this.write(state);
  }

  /** Send every due batch through `send`; a failed send keeps its items for the next tick. Returns batches sent. */
  async flushDue(send: (tenantId: string, text: string) => Promise<boolean>, now = Date.now()): Promise<number> {
    let sent = 0;
    for (const tenantId of this.due(now)) {
      const items = this.take(tenantId);
      if (items.length === 0) continue;
      let ok = false;
      try {
        ok = await send(tenantId, composeNotifyBatch(items));
      } catch {
        ok = false;
      }
      if (ok) sent += 1;
      else this.restore(tenantId, items);
    }
    return sent;
  }
}
