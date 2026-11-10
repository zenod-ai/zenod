import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { openZenodSqlite } from "./sqlite.js";

/**
 * Personas' switches and run log (EPIC-14 S4). One SQLite file per tenant on the /data volume,
 * beside the inbox, so a run can never be read across tenants. What a persona finds is not kept
 * here: its notes are one commit in its own folder of the memory repo and its findings and
 * questions are inbox items. This file holds only what the settings screen and the caps need:
 * on or off, and each run's time, steps, tokens and cost.
 */

export type PersonaTrigger = "schedule" | "manual";

/** done: it ran; skipped: nothing new, no model call; capped: a step or spend cap stopped it; failed: an error. */
export type PersonaRunStatus = "running" | "done" | "skipped" | "capped" | "failed";

export interface PersonaRun {
  id: string;
  personaId: string;
  trigger: PersonaTrigger;
  /** The schedule period this run covers (`2026-11-08`), so a night is run once; null for Run now. */
  periodKey: string | null;
  status: PersonaRunStatus;
  startedAt: string;
  endedAt: string | null;
  steps: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** One line: what it did or why it stopped. */
  summary: string;
  inboxItemIds: string[];
  /** The commit of its notes, when it wrote any. */
  revision: string | null;
  /** What the run saw, so the next wake can skip when nothing is new (Epic Team's skip-unchanged). */
  fingerprint: string | null;
}

export interface PersonaRunEnd {
  status: Exclude<PersonaRunStatus, "running">;
  steps: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  summary: string;
  inboxItemIds: string[];
  revision: string | null;
  fingerprint: string | null;
}

interface RunRow {
  id: string;
  persona_id: string;
  trigger: string;
  period_key: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  steps: number;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  summary: string;
  inbox_item_ids: string;
  revision: string | null;
  fingerprint: string | null;
}

function rowToRun(row: RunRow): PersonaRun {
  return {
    id: row.id,
    personaId: row.persona_id,
    trigger: row.trigger as PersonaTrigger,
    periodKey: row.period_key,
    status: row.status as PersonaRunStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    steps: row.steps,
    modelCalls: row.model_calls,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    summary: row.summary,
    inboxItemIds: JSON.parse(row.inbox_item_ids) as string[],
    revision: row.revision,
    fingerprint: row.fingerprint,
  };
}

export class PersonaStore {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(path: string, private readonly now: () => Date = () => new Date()) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS persona_settings (
        persona_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS persona_runs (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        period_key TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        steps INTEGER NOT NULL DEFAULT 0,
        model_calls INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        inbox_item_ids TEXT NOT NULL DEFAULT '[]',
        revision TEXT,
        fingerprint TEXT
      );
      CREATE INDEX IF NOT EXISTS persona_runs_persona ON persona_runs(persona_id, started_at);
      CREATE UNIQUE INDEX IF NOT EXISTS persona_runs_period ON persona_runs(persona_id, period_key) WHERE period_key IS NOT NULL;
    `);
    // Round 2: the user's own cadence per persona (JSON, null = its default).
    const columns = this.db.prepare(`PRAGMA table_info(persona_settings)`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "cadence")) this.db.exec(`ALTER TABLE persona_settings ADD COLUMN cadence TEXT`);
    // EPIC-14 S35: when the user switched asking the Team desk on for this helper (ISO); null: off, the default.
    if (!columns.some((column) => column.name === "ask_team_at")) this.db.exec(`ALTER TABLE persona_settings ADD COLUMN ask_team_at TEXT`);
  }

  /** S35: when asking the Team desk was switched on for this helper, or null while it is off. */
  askTeamSince(personaId: string): string | null {
    const row = this.db.prepare(`SELECT ask_team_at FROM persona_settings WHERE persona_id=?`).get(personaId) as { ask_team_at: string | null } | undefined;
    return row?.ask_team_at ?? null;
  }

  /** When this helper's settings last changed (ISO), or null when the user never changed them. */
  settingsUpdatedAt(personaId: string): string | null {
    const row = this.db.prepare(`SELECT updated_at FROM persona_settings WHERE persona_id=?`).get(personaId) as { updated_at: string } | undefined;
    return row?.updated_at ?? null;
  }

  askTeam(personaId: string): boolean {
    return this.askTeamSince(personaId) !== null;
  }

  /** `defaultEnabled` fills a new row, so switching asking on never switches the helper on. */
  setAskTeam(personaId: string, on: boolean, defaultEnabled: boolean): void {
    if (on && this.askTeam(personaId)) return;
    const at = this.now().toISOString();
    this.db
      .prepare(`INSERT INTO persona_settings (persona_id, enabled, updated_at, ask_team_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(persona_id) DO UPDATE SET ask_team_at=excluded.ask_team_at, updated_at=excluded.updated_at`)
      .run(personaId, defaultEnabled ? 1 : 0, at, on ? at : null);
  }

  /** On or off; null when the user never switched it (the persona's default applies). */
  enabled(personaId: string): boolean | null {
    const row = this.db.prepare(`SELECT enabled FROM persona_settings WHERE persona_id=?`).get(personaId) as { enabled: number } | undefined;
    return row ? row.enabled === 1 : null;
  }

  /**
   * EPIC-23 E23-A2: keep a helper on, as an explicit switch, for an account that used helpers before
   * `beforeIso` (a run or a settings change) and never switched this one itself. An account made later
   * gets the helper's new default. Returns true when it wrote the switch.
   */
  keepOnIfUsedBefore(personaId: string, beforeIso: string): boolean {
    if (this.enabled(personaId) !== null) return false;
    const ran = this.db.prepare(`SELECT 1 FROM persona_runs WHERE started_at < ? LIMIT 1`).get(beforeIso);
    const set = this.db.prepare(`SELECT 1 FROM persona_settings WHERE updated_at < ? LIMIT 1`).get(beforeIso);
    if (!ran && !set) return false;
    this.setEnabled(personaId, true);
    return true;
  }

  /** `defaultEnabled` fills a new row when only the cadence is set, so setting it never switches one on. */
  setEnabled(personaId: string, enabled: boolean): void {
    this.db
      .prepare(`INSERT INTO persona_settings (persona_id, enabled, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(persona_id) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at`)
      .run(personaId, enabled ? 1 : 0, this.now().toISOString());
  }

  /** The user's cadence for a persona, as stored (the runner validates it); null for its default. */
  cadence(personaId: string): unknown {
    const row = this.db.prepare(`SELECT cadence FROM persona_settings WHERE persona_id=?`).get(personaId) as { cadence: string | null } | undefined;
    if (!row?.cadence) return null;
    try {
      return JSON.parse(row.cadence) as unknown;
    } catch {
      return null;
    }
  }

  setCadence(personaId: string, cadence: object | null, defaultEnabled: boolean): void {
    this.db
      .prepare(`INSERT INTO persona_settings (persona_id, enabled, updated_at, cadence) VALUES (?, ?, ?, ?)
                ON CONFLICT(persona_id) DO UPDATE SET cadence=excluded.cadence, updated_at=excluded.updated_at`)
      .run(personaId, defaultEnabled ? 1 : 0, this.now().toISOString(), cadence ? JSON.stringify(cadence) : null);
  }

  /**
   * Start a run. A scheduled run names its period: a second start for the same persona and period
   * returns null, so a night is run once even across restarts.
   */
  start(personaId: string, trigger: PersonaTrigger, periodKey: string | null = null): PersonaRun | null {
    const id = randomUUID();
    const result = this.db
      .prepare(`INSERT INTO persona_runs (id, persona_id, trigger, period_key, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)
                ON CONFLICT DO NOTHING`)
      .run(id, personaId, trigger, periodKey, this.now().toISOString());
    return Number(result.changes) === 1 ? this.get(id) : null;
  }

  finish(id: string, end: PersonaRunEnd): PersonaRun {
    this.db
      .prepare(`UPDATE persona_runs SET status=?, ended_at=?, steps=?, model_calls=?, input_tokens=?, output_tokens=?, cost_usd=?,
                summary=?, inbox_item_ids=?, revision=?, fingerprint=? WHERE id=?`)
      .run(end.status, this.now().toISOString(), end.steps, end.modelCalls, end.inputTokens, end.outputTokens, end.costUsd,
        end.summary.slice(0, 500), JSON.stringify(end.inboxItemIds), end.revision, end.fingerprint, id);
    return this.get(id)!;
  }

  /** A restart left runs "running": they end as failed, so their period can be run again. */
  recoverInterrupted(): number {
    const stale = this.db.prepare(`SELECT id FROM persona_runs WHERE status='running'`).all() as Array<{ id: string }>;
    for (const { id } of stale) {
      this.db
        .prepare(`UPDATE persona_runs SET status='failed', ended_at=?, summary='Stopped by a restart', period_key=NULL WHERE id=?`)
        .run(this.now().toISOString(), id);
    }
    return stale.length;
  }

  get(id: string): PersonaRun | null {
    const row = this.db.prepare(`SELECT * FROM persona_runs WHERE id=?`).get(id) as RunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  runs(personaId: string, limit = 10): PersonaRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM persona_runs WHERE persona_id=? ORDER BY started_at DESC, rowid DESC LIMIT ?`)
      .all(personaId, limit) as unknown as RunRow[];
    return rows.map(rowToRun);
  }

  /** The last run that really looked (done or capped), whose fingerprint the next wake compares. */
  lastRealRun(personaId: string): PersonaRun | null {
    const row = this.db
      .prepare(`SELECT * FROM persona_runs WHERE persona_id=? AND status IN ('done', 'capped') ORDER BY started_at DESC, rowid DESC LIMIT 1`)
      .get(personaId) as RunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  hasRunForPeriod(personaId: string, periodKey: string): boolean {
    return this.db.prepare(`SELECT 1 FROM persona_runs WHERE persona_id=? AND period_key=?`).get(personaId, periodKey) !== undefined;
  }

  /** Spend since `sinceIso` for one persona, or for all of them without one. */
  spendSince(sinceIso: string, personaId?: string): number {
    const row = (personaId
      ? this.db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM persona_runs WHERE started_at>=? AND persona_id=?`).get(sinceIso, personaId)
      : this.db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM persona_runs WHERE started_at>=?`).get(sinceIso)) as { usd: number };
    return row.usd;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

const stores = new Map<string, PersonaStore>();

/** EPIC-23 E23-A2: from here on, new accounts start with the weekly recap off. */
export const WEEKLY_RECAP_OFF_SINCE = "2026-11-11T00:00:00.000Z";

/** The tenant's persona store, opened once per data directory (like inboxFor). */
export function personasFor(runtime: { readonly dataDir: string }): PersonaStore {
  let store = stores.get(runtime.dataDir);
  if (!store) {
    store = new PersonaStore(join(runtime.dataDir, "personas.sqlite"));
    store.recoverInterrupted();
    // EPIC-23 E23-A2: the weekly recap is off for new accounts (testers start with memory only); accounts
    // that used helpers before the change keep it on.
    store.keepOnIfUsedBefore("weekly-recap", WEEKLY_RECAP_OFF_SINCE);
    // EPIC-14 S38: Something to try comes switched on for those same accounts (the owner's), off for testers.
    store.keepOnIfUsedBefore("something-to-try", WEEKLY_RECAP_OFF_SINCE);
    stores.set(runtime.dataDir, store);
  }
  return store;
}

export function closePersonasFor(runtime: { readonly dataDir: string }): void {
  stores.get(runtime.dataDir)?.close();
  stores.delete(runtime.dataDir);
}
