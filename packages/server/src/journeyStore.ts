import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openZenodSqlite } from "./sqlite.js";

export type JourneyStatus = "active" | "completed" | "blocked" | "cancelled";
export type JourneyStepStatus = "pending" | "dispatched" | "running" | "completed" | "blocked" | "failed" | "cancelled";

export interface JourneyContext {
  [key: string]: unknown;
}

export interface Journey {
  id: string;
  conversationId: string | null;
  surface: string;
  originalRequest: string;
  context: JourneyContext;
  status: JourneyStatus;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface JourneyStep {
  id: string;
  journeyId: string;
  sequence: number;
  owner: string;
  title: string;
  input: JourneyContext;
  status: JourneyStepStatus;
  dependencyIds: string[];
  idempotencyKey: string | null;
  externalRefs: JourneyContext;
  dispatchAfter: number | null;
  wakeAt: number | null;
  leaseUntil: number | null;
  attemptCount: number;
  deadlineAt: number | null;
  dispatchedAt: number | null;
  completedAt: number | null;
  result: JourneyContext | null;
  error: string | null;
  blocker: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface JourneyArtifact {
  id: string;
  journeyId: string;
  stepId: string | null;
  kind: string;
  artifactKey: string;
  data: JourneyContext;
  createdAt: number;
  updatedAt: number;
}

export type JourneyEventType =
  | "journey_created"
  | "journey_completed"
  | "journey_blocked"
  | "artifact_added"
  | "step_added"
  | "step_ready"
  | "step_dispatched"
  | "step_running"
  | "step_callback_received"
  | "step_completed"
  | "step_blocked"
  | "step_failed";

export interface JourneyEvent {
  id: string;
  journeyId: string;
  stepId: string | null;
  type: JourneyEventType;
  payload: JourneyContext;
  createdAt: number;
}

export interface JourneySnapshot {
  journey: Journey;
  steps: JourneyStep[];
  artifacts: JourneyArtifact[];
  events: JourneyEvent[];
}

export interface CreateJourneyInput {
  conversationId?: string | null;
  surface: string;
  originalRequest: string;
  context?: JourneyContext;
}

export interface AddJourneyStepInput {
  owner: string;
  title: string;
  input?: JourneyContext;
  dependencyIds?: string[];
  idempotencyKey?: string | null;
  externalRefs?: JourneyContext;
  dispatchAfter?: number | null;
  wakeAt?: number | null;
  deadlineAt?: number | null;
}

export interface AddJourneyArtifactInput {
  stepId?: string | null;
  kind: string;
  artifactKey: string;
  data?: JourneyContext;
}

interface JourneyRow {
  id: string;
  conversation_id: string | null;
  surface: string;
  original_request: string;
  context_json: string;
  status: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface StepRow {
  id: string;
  journey_id: string;
  sequence: number;
  owner: string;
  title: string;
  input_json: string;
  status: string;
  dependency_ids_json: string;
  idempotency_key: string | null;
  external_refs_json: string;
  dispatch_after: number | null;
  wake_at: number | null;
  lease_until: number | null;
  attempt_count: number;
  deadline_at: number | null;
  dispatched_at: number | null;
  completed_at: number | null;
  result_json: string | null;
  error: string | null;
  blocker: string | null;
  created_at: number;
  updated_at: number;
}

interface ArtifactRow {
  id: string;
  journey_id: string;
  step_id: string | null;
  kind: string;
  artifact_key: string;
  data_json: string;
  created_at: number;
  updated_at: number;
}

interface EventRow {
  id: string;
  journey_id: string;
  step_id: string | null;
  type: string;
  payload_json: string;
  created_at: number;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  return JSON.parse(value) as T;
}

function rowToJourney(row: JourneyRow): Journey {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    surface: row.surface,
    originalRequest: row.original_request,
    context: parseJson(row.context_json, {}),
    status: row.status as JourneyStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function rowToStep(row: StepRow): JourneyStep {
  return {
    id: row.id,
    journeyId: row.journey_id,
    sequence: row.sequence,
    owner: row.owner,
    title: row.title,
    input: parseJson(row.input_json, {}),
    status: row.status as JourneyStepStatus,
    dependencyIds: parseJson(row.dependency_ids_json, []),
    idempotencyKey: row.idempotency_key,
    externalRefs: parseJson(row.external_refs_json, {}),
    dispatchAfter: row.dispatch_after,
    wakeAt: row.wake_at,
    leaseUntil: row.lease_until,
    attemptCount: row.attempt_count,
    deadlineAt: row.deadline_at,
    dispatchedAt: row.dispatched_at,
    completedAt: row.completed_at,
    result: row.result_json ? parseJson(row.result_json, {}) : null,
    error: row.error,
    blocker: row.blocker,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToArtifact(row: ArtifactRow): JourneyArtifact {
  return {
    id: row.id,
    journeyId: row.journey_id,
    stepId: row.step_id,
    kind: row.kind,
    artifactKey: row.artifact_key,
    data: parseJson(row.data_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvent(row: EventRow): JourneyEvent {
  return {
    id: row.id,
    journeyId: row.journey_id,
    stepId: row.step_id,
    type: row.type as JourneyEventType,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

export class JourneyStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS journeys (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        surface TEXT NOT NULL,
        original_request TEXT NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS journeys_status_updated ON journeys(status, updated_at);
      CREATE INDEX IF NOT EXISTS journeys_conversation ON journeys(conversation_id, updated_at);

      CREATE TABLE IF NOT EXISTS journey_steps (
        id TEXT PRIMARY KEY,
        journey_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        owner TEXT NOT NULL,
        title TEXT NOT NULL,
        input_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        dependency_ids_json TEXT NOT NULL DEFAULT '[]',
        idempotency_key TEXT,
        external_refs_json TEXT NOT NULL DEFAULT '{}',
        dispatch_after INTEGER,
        wake_at INTEGER,
        lease_until INTEGER,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        deadline_at INTEGER,
        dispatched_at INTEGER,
        completed_at INTEGER,
        result_json TEXT,
        error TEXT,
        blocker TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS journey_steps_journey_sequence ON journey_steps(journey_id, sequence);
      CREATE INDEX IF NOT EXISTS journey_steps_status_deadline ON journey_steps(status, deadline_at);

      CREATE TABLE IF NOT EXISTS journey_artifacts (
        id TEXT PRIMARY KEY,
        journey_id TEXT NOT NULL,
        step_id TEXT,
        kind TEXT NOT NULL,
        artifact_key TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS journey_artifacts_key ON journey_artifacts(journey_id, artifact_key);
      CREATE INDEX IF NOT EXISTS journey_artifacts_journey_kind ON journey_artifacts(journey_id, kind);

      CREATE TABLE IF NOT EXISTS journey_events (
        id TEXT PRIMARY KEY,
        journey_id TEXT NOT NULL,
        step_id TEXT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS journey_events_journey_created ON journey_events(journey_id, created_at);
    `);
    this.migrate();
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS journey_steps_status_wake ON journey_steps(status, wake_at, lease_until);
      CREATE UNIQUE INDEX IF NOT EXISTS journey_steps_idempotency
        ON journey_steps(journey_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
  }

  create(input: CreateJourneyInput, now: number = Date.now()): Journey {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO journeys (
           id, conversation_id, surface, original_request, context_json,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        id,
        input.conversationId ?? null,
        input.surface,
        input.originalRequest,
        JSON.stringify(input.context ?? {}),
        now,
        now,
      );
    this.appendEvent(id, null, "journey_created", { surface: input.surface }, now);
    return this.get(id)!;
  }

  addStep(journeyId: string, input: AddJourneyStepInput, now: number = Date.now()): JourneyStep {
    const journey = this.get(journeyId);
    if (!journey) throw new Error(`Journey not found: ${journeyId}`);
    if (input.idempotencyKey) {
      const existing = this.stepByIdempotencyKey(journeyId, input.idempotencyKey);
      if (existing) return existing;
    }
    const id = randomUUID();
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM journey_steps WHERE journey_id=?`)
      .get(journeyId) as { next_sequence: number };
    this.db
      .prepare(
        `INSERT INTO journey_steps (
           id, journey_id, sequence, owner, title, input_json, status,
           dependency_ids_json, idempotency_key, external_refs_json,
           dispatch_after, wake_at, deadline_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        journeyId,
        row.next_sequence,
        input.owner,
        input.title,
        JSON.stringify(input.input ?? {}),
        JSON.stringify(input.dependencyIds ?? []),
        input.idempotencyKey ?? null,
        JSON.stringify(input.externalRefs ?? {}),
        input.dispatchAfter ?? null,
        input.wakeAt ?? input.dispatchAfter ?? null,
        input.deadlineAt ?? null,
        now,
        now,
      );
    this.touchJourney(journeyId, now);
    this.appendEvent(journeyId, id, "step_added", { owner: input.owner, title: input.title }, now);
    return this.getStep(id)!;
  }

  addArtifact(journeyId: string, input: AddJourneyArtifactInput, now: number = Date.now()): JourneyArtifact {
    const journey = this.get(journeyId);
    if (!journey) throw new Error(`Journey not found: ${journeyId}`);
    const existing = this.artifactByKey(journeyId, input.artifactKey);
    if (existing) return existing;
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO journey_artifacts (
           id, journey_id, step_id, kind, artifact_key, data_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, journeyId, input.stepId ?? null, input.kind, input.artifactKey, JSON.stringify(input.data ?? {}), now, now);
    this.touchJourney(journeyId, now);
    this.appendEvent(journeyId, input.stepId ?? null, "artifact_added", { kind: input.kind, artifactKey: input.artifactKey }, now);
    return this.artifactByKey(journeyId, input.artifactKey)!;
  }

  /** Refresh an existing artifact's data in place (addArtifact never overwrites). */
  updateArtifactData(journeyId: string, artifactKey: string, data: JourneyContext, now: number = Date.now()): JourneyArtifact | null {
    const existing = this.artifactByKey(journeyId, artifactKey);
    if (!existing) return null;
    this.db
      .prepare(`UPDATE journey_artifacts SET data_json=?, updated_at=? WHERE id=?`)
      .run(JSON.stringify(data ?? {}), now, existing.id);
    this.touchJourney(journeyId, now);
    return this.artifactByKey(journeyId, artifactKey);
  }

  dispatchStep(stepId: string, patch: { deadlineAt?: number | null } = {}, now: number = Date.now()): JourneyStep {
    const step = this.requireStep(stepId);
    this.db
      .prepare(
        `UPDATE journey_steps
         SET status='dispatched', deadline_at=COALESCE(?, deadline_at),
             wake_at=COALESCE(?, wake_at),
             dispatched_at=?, updated_at=?
         WHERE id=?`,
      )
      .run(patch.deadlineAt ?? null, patch.deadlineAt ?? null, now, now, stepId);
    this.touchJourney(step.journeyId, now);
    this.appendEvent(step.journeyId, stepId, "step_dispatched", { owner: step.owner }, now);
    return this.getStep(stepId)!;
  }

  runStep(stepId: string, patch: { deadlineAt?: number | null } = {}, now: number = Date.now()): JourneyStep {
    const step = this.requireStep(stepId);
    this.db
      .prepare(
        `UPDATE journey_steps
         SET status='running', deadline_at=COALESCE(?, deadline_at),
             wake_at=COALESCE(?, wake_at),
             dispatched_at=COALESCE(dispatched_at, ?), updated_at=?
         WHERE id=?`,
      )
      .run(patch.deadlineAt ?? null, patch.deadlineAt ?? null, now, now, stepId);
    this.touchJourney(step.journeyId, now);
    this.appendEvent(step.journeyId, stepId, "step_running", { owner: step.owner }, now);
    return this.getStep(stepId)!;
  }

  completeStep(stepId: string, result: JourneyContext = {}, now: number = Date.now()): JourneyStep {
    const step = this.requireStep(stepId);
    this.db
      .prepare(
        `UPDATE journey_steps
         SET status='completed', result_json=?, error=NULL, blocker=NULL, completed_at=?, lease_until=NULL, updated_at=?
         WHERE id=?`,
      )
      .run(JSON.stringify(result), now, now, stepId);
    this.appendEvent(step.journeyId, stepId, "step_completed", result, now);
    this.touchJourney(step.journeyId, now);
    this.readyPendingDependents(step.journeyId, now);
    return this.getStep(stepId)!;
  }

  completeJourneyIfReady(journeyId: string, now: number = Date.now()): boolean {
    const journey = this.get(journeyId);
    if (!journey || journey.status !== "active") return false;
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS remaining
         FROM journey_steps
         WHERE journey_id=? AND status NOT IN ('completed', 'cancelled')`,
      )
      .get(journeyId) as { remaining: number };
    if (row.remaining !== 0) return false;
    this.db
      .prepare(`UPDATE journeys SET status='completed', completed_at=?, updated_at=? WHERE id=?`)
      .run(now, now, journeyId);
    this.appendEvent(journeyId, null, "journey_completed", {}, now);
    return true;
  }

  failStep(stepId: string, error: string, now: number = Date.now()): JourneyStep {
    const step = this.requireStep(stepId);
    this.db
      .prepare(`UPDATE journey_steps SET status='failed', error=?, lease_until=NULL, updated_at=? WHERE id=?`)
      .run(error, now, stepId);
    this.db
      .prepare(`UPDATE journeys SET status='blocked', updated_at=? WHERE id=? AND status='active'`)
      .run(now, step.journeyId);
    this.touchJourney(step.journeyId, now);
    this.appendEvent(step.journeyId, stepId, "step_failed", { error }, now);
    this.appendEvent(step.journeyId, null, "journey_blocked", { stepId, reason: error }, now);
    return this.getStep(stepId)!;
  }

  recordStepCallback(stepId: string, payload: JourneyContext = {}, now: number = Date.now()): void {
    const step = this.requireStep(stepId);
    this.appendEvent(step.journeyId, stepId, "step_callback_received", payload, now);
    this.touchJourney(step.journeyId, now);
  }

  readyPendingDependents(journeyId: string, now: number = Date.now()): JourneyStep[] {
    const pending = this.stepsForJourney(journeyId).filter((step) => step.status === "pending" && step.dependencyIds.length > 0);
    const ready: JourneyStep[] = [];
    for (const step of pending) {
      if (!this.dependenciesSatisfied(journeyId, step.dependencyIds)) continue;
      if (step.wakeAt === null) {
        this.db.prepare(`UPDATE journey_steps SET wake_at=?, updated_at=? WHERE id=?`).run(now, now, step.id);
        this.appendEvent(journeyId, step.id, "step_ready", { dependencyIds: step.dependencyIds }, now);
        ready.push(this.getStep(step.id)!);
      } else {
        ready.push(step);
      }
    }
    if (ready.length > 0) this.touchJourney(journeyId, now);
    return ready;
  }

  blockStep(stepId: string, reason: string, now: number = Date.now()): JourneyStep {
    const step = this.requireStep(stepId);
    this.db
      .prepare(`UPDATE journey_steps SET status='blocked', error=?, blocker=?, lease_until=NULL, updated_at=? WHERE id=?`)
      .run(reason, reason, now, stepId);
    this.db
      .prepare(`UPDATE journeys SET status='blocked', updated_at=? WHERE id=? AND status='active'`)
      .run(now, step.journeyId);
    this.appendEvent(step.journeyId, stepId, "step_blocked", { reason }, now);
    this.appendEvent(step.journeyId, null, "journey_blocked", { stepId, reason }, now);
    return this.getStep(stepId)!;
  }

  overdueSteps(now: number = Date.now(), limit = 50): JourneyStep[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM journey_steps
         WHERE status IN ('dispatched', 'running')
           AND deadline_at IS NOT NULL
           AND deadline_at <= ?
         ORDER BY deadline_at ASC
         LIMIT ?`,
      )
      .all(now, limit) as unknown as StepRow[];
    return rows.map(rowToStep);
  }

  blockOverdueSteps(now: number = Date.now(), limit = 50): JourneyStep[] {
    const blocked: JourneyStep[] = [];
    for (const step of this.overdueSteps(now, limit)) {
      blocked.push(this.blockStep(step.id, `step timed out at ${new Date(now).toISOString()}`, now));
    }
    return blocked;
  }

  claimDueSteps(now: number = Date.now(), leaseMs = 60_000, limit = 50): JourneyStep[] {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db
        .prepare(
          `SELECT journey_steps.* FROM journey_steps
           JOIN journeys ON journeys.id = journey_steps.journey_id
           WHERE journeys.status = 'active'
             AND journey_steps.status IN ('pending', 'dispatched', 'running')
             AND (journey_steps.wake_at IS NULL OR journey_steps.wake_at <= ?)
             AND (journey_steps.lease_until IS NULL OR journey_steps.lease_until <= ?)
           ORDER BY COALESCE(journey_steps.wake_at, journey_steps.created_at) ASC
           LIMIT ?`,
        )
        .all(now, now, Math.max(limit * 5, limit)) as unknown as StepRow[];
      const claimable = rows
        .filter((row) => this.dependenciesSatisfied(row.journey_id, parseJson(row.dependency_ids_json, [])))
        .slice(0, limit);
      for (const row of claimable) {
        this.db
          .prepare(
            `UPDATE journey_steps
             SET lease_until=?, attempt_count=attempt_count + 1, updated_at=?
             WHERE id=? AND (lease_until IS NULL OR lease_until <= ?)`,
          )
          .run(now + leaseMs, now, row.id, now);
      }
      this.db.exec("COMMIT");
      return claimable.map((row) => this.getStep(row.id)).filter((step): step is JourneyStep => Boolean(step));
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  get(id: string): Journey | null {
    const row = this.db.prepare(`SELECT * FROM journeys WHERE id=?`).get(id) as JourneyRow | undefined;
    return row ? rowToJourney(row) : null;
  }

  getStep(id: string): JourneyStep | null {
    const row = this.db.prepare(`SELECT * FROM journey_steps WHERE id=?`).get(id) as StepRow | undefined;
    return row ? rowToStep(row) : null;
  }

  snapshot(id: string): JourneySnapshot | null {
    const journey = this.get(id);
    if (!journey) return null;
    return {
      journey,
      steps: this.stepsForJourney(id),
      artifacts: this.artifactsForJourney(id),
      events: this.eventsForJourney(id),
    };
  }

  stepsForJourney(journeyId: string): JourneyStep[] {
    const rows = this.db
      .prepare(`SELECT * FROM journey_steps WHERE journey_id=? ORDER BY sequence ASC`)
      .all(journeyId) as unknown as StepRow[];
    return rows.map(rowToStep);
  }

  eventsForJourney(journeyId: string): JourneyEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM journey_events WHERE journey_id=? ORDER BY created_at ASC`)
      .all(journeyId) as unknown as EventRow[];
    return rows.map(rowToEvent);
  }

  artifactsForJourney(journeyId: string): JourneyArtifact[] {
    const rows = this.db
      .prepare(`SELECT * FROM journey_artifacts WHERE journey_id=? ORDER BY created_at ASC`)
      .all(journeyId) as unknown as ArtifactRow[];
    return rows.map(rowToArtifact);
  }

  recent(limit = 25): Journey[] {
    const rows = this.db
      .prepare(`SELECT * FROM journeys ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as unknown as JourneyRow[];
    return rows.map(rowToJourney);
  }

  /** Recent artifacts of a given kind across all journeys, newest first (R1-T3). */
  artifactsByKind(kind: string, limit = 100): JourneyArtifact[] {
    const rows = this.db
      .prepare(`SELECT * FROM journey_artifacts WHERE kind=? ORDER BY updated_at DESC LIMIT ?`)
      .all(kind, limit) as unknown as ArtifactRow[];
    return rows.map(rowToArtifact);
  }

  close(): void {
    this.db.close();
  }

  private requireStep(id: string): JourneyStep {
    const step = this.getStep(id);
    if (!step) throw new Error(`Journey step not found: ${id}`);
    return step;
  }

  private stepByIdempotencyKey(journeyId: string, idempotencyKey: string): JourneyStep | null {
    const row = this.db
      .prepare(`SELECT * FROM journey_steps WHERE journey_id=? AND idempotency_key=?`)
      .get(journeyId, idempotencyKey) as StepRow | undefined;
    return row ? rowToStep(row) : null;
  }

  private artifactByKey(journeyId: string, artifactKey: string): JourneyArtifact | null {
    const row = this.db
      .prepare(`SELECT * FROM journey_artifacts WHERE journey_id=? AND artifact_key=?`)
      .get(journeyId, artifactKey) as ArtifactRow | undefined;
    return row ? rowToArtifact(row) : null;
  }

  private dependenciesSatisfied(journeyId: string, dependencyIds: string[]): boolean {
    if (dependencyIds.length === 0) return true;
    const placeholders = dependencyIds.map(() => "?").join(", ");
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS completed
         FROM journey_steps
         WHERE journey_id=? AND id IN (${placeholders}) AND status='completed'`,
      )
      .get(journeyId, ...dependencyIds) as { completed: number };
    return row.completed === dependencyIds.length;
  }

  private appendEvent(
    journeyId: string,
    stepId: string | null,
    type: JourneyEventType,
    payload: JourneyContext,
    now: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO journey_events (id, journey_id, step_id, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), journeyId, stepId, type, JSON.stringify(payload), now);
  }

  private touchJourney(journeyId: string, now: number): void {
    this.db.prepare(`UPDATE journeys SET updated_at=? WHERE id=?`).run(now, journeyId);
  }

  private migrate(): void {
    const columns = [
      ["dependency_ids_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["idempotency_key", "TEXT"],
      ["external_refs_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["wake_at", "INTEGER"],
      ["lease_until", "INTEGER"],
      ["attempt_count", "INTEGER NOT NULL DEFAULT 0"],
      ["blocker", "TEXT"],
    ] as const;
    for (const [name, definition] of columns) {
      try {
        this.db.exec(`ALTER TABLE journey_steps ADD COLUMN ${name} ${definition}`);
      } catch (err) {
        if (!String((err as Error).message).includes("duplicate column name")) throw err;
      }
    }
  }
}
