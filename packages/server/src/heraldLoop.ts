import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { openZenodSqlite } from "./sqlite.js";

export const HERALD_MIN_CADENCE_MINUTES = 15;
export const HERALD_DEFAULT_PROPOSAL_COUNT = 3;
export const HERALD_MAX_PROPOSAL_COUNT = 10;

export type HeraldBoardState = "proposed" | "approved" | "posted" | "rejected";
export type HeraldWakeSource = "scheduled" | "run_now";
export type HeraldWakeStatus = "running" | "completed" | "refused" | "skipped" | "failed";

export interface HeraldBriefingContent {
  theme: string;
  objectives: string[];
  tone: string;
  replyPolicy: string;
  [key: string]: unknown;
}

export interface HeraldBriefing {
  tenantId: string;
  version: number;
  content: HeraldBriefingContent;
  cadenceMinutes: number;
  proposalCount: number;
  approvedAt: number;
  createdAt: number;
}

export interface HeraldBoardItem {
  id: string;
  tenantId: string;
  wakeId: string | null;
  state: HeraldBoardState;
  text: string;
  rationale: string;
  memoryCitation: string;
  permalink: string | null;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
  rejectedAt: number | null;
  postedAt: number | null;
}

export interface HeraldProposalInput {
  text: string;
  rationale: string;
  memoryCitation: string;
}

export interface HeraldFiling {
  id: string;
  tenantId: string;
  kind: string;
  content: string;
  memoryCitation: string | null;
  commitReceipt: string;
  createdAt: number;
}

export interface HeraldMutationReceipt {
  status: "ok" | "error";
  code: string;
  message: string;
  tenantId: string;
  ids?: string[];
}

export interface HeraldWakeReceipt {
  wakeId: string;
  tenantId: string;
  source: HeraldWakeSource;
  status: Exclude<HeraldWakeStatus, "running">;
  code:
    | "wake_completed"
    | "briefing_required"
    | "cadence_throttled"
    | "proposal_pileup"
    | "wake_in_progress"
    | "wake_failed";
  message: string;
  proposalIds: string[];
  createdAt: number;
  completedAt: number;
}

interface BriefingRow {
  tenant_id: string;
  version: number;
  content_json: string;
  cadence_minutes: number;
  proposal_count: number;
  approved_at: number;
  created_at: number;
}

interface BoardRow {
  id: string;
  tenant_id: string;
  wake_id: string | null;
  state: string;
  text: string;
  rationale: string;
  memory_citation: string;
  permalink: string | null;
  created_at: number;
  updated_at: number;
  approved_at: number | null;
  rejected_at: number | null;
  posted_at: number | null;
}

interface WakeRow {
  id: string;
  tenant_id: string;
  source: string;
  status: string;
  code: string | null;
  message: string | null;
  proposal_ids_json: string;
  created_at: number;
  completed_at: number | null;
}

interface FilingRow {
  id: string;
  tenant_id: string;
  kind: string;
  content: string;
  memory_citation: string | null;
  commit_receipt: string;
  created_at: number;
}

function briefingFromRow(row: BriefingRow): HeraldBriefing {
  return {
    tenantId: row.tenant_id,
    version: row.version,
    content: JSON.parse(row.content_json) as HeraldBriefingContent,
    cadenceMinutes: row.cadence_minutes,
    proposalCount: row.proposal_count,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

function boardFromRow(row: BoardRow): HeraldBoardItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    wakeId: row.wake_id,
    state: row.state as HeraldBoardState,
    text: row.text,
    rationale: row.rationale,
    memoryCitation: row.memory_citation,
    permalink: row.permalink,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    postedAt: row.posted_at,
  };
}

function filingFromRow(row: FilingRow): HeraldFiling {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind,
    content: row.content,
    memoryCitation: row.memory_citation,
    commitReceipt: row.commit_receipt,
    createdAt: row.created_at,
  };
}

function wakeFromRow(row: WakeRow): HeraldWakeReceipt | null {
  if (row.status === "running" || !row.code || !row.message || row.completed_at === null) return null;
  return {
    wakeId: row.id,
    tenantId: row.tenant_id,
    source: row.source as HeraldWakeSource,
    status: row.status as HeraldWakeReceipt["status"],
    code: row.code as HeraldWakeReceipt["code"],
    message: row.message,
    proposalIds: JSON.parse(row.proposal_ids_json || "[]") as string[],
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function normalizeCadence(value: number): number {
  if (!Number.isFinite(value)) return HERALD_MIN_CADENCE_MINUTES;
  return Math.max(HERALD_MIN_CADENCE_MINUTES, Math.floor(value));
}

function normalizeProposalCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return HERALD_DEFAULT_PROPOSAL_COUNT;
  return Math.max(1, Math.min(HERALD_MAX_PROPOSAL_COUNT, Math.floor(value)));
}

/**
 * Herald's tenant-local working memory. This deliberately lives in the shipped
 * server package, beside the Ring runtime it extends; it is not a standalone
 * loop engine. Long-term lessons are filed through Zenod by the callers, while
 * the receipt is retained here for the board/chat read model.
 */
export class HeraldLoopStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS herald_briefings (
        tenant_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content_json TEXT NOT NULL,
        cadence_minutes INTEGER NOT NULL CHECK (cadence_minutes >= ${HERALD_MIN_CADENCE_MINUTES}),
        proposal_count INTEGER NOT NULL CHECK (proposal_count BETWEEN 1 AND ${HERALD_MAX_PROPOSAL_COUNT}),
        approved_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, version)
      );
      CREATE INDEX IF NOT EXISTS herald_briefings_current
        ON herald_briefings (tenant_id, version DESC);

      CREATE TABLE IF NOT EXISTS herald_wakes (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('scheduled', 'run_now')),
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'refused', 'skipped', 'failed')),
        code TEXT,
        message TEXT,
        proposal_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS herald_one_running_wake_per_tenant
        ON herald_wakes (tenant_id) WHERE status = 'running';
      CREATE INDEX IF NOT EXISTS herald_wakes_tenant_created
        ON herald_wakes (tenant_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS herald_board_items (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        wake_id TEXT,
        state TEXT NOT NULL CHECK (state IN ('proposed', 'approved', 'posted', 'rejected')),
        text TEXT NOT NULL,
        rationale TEXT NOT NULL,
        memory_citation TEXT NOT NULL,
        permalink TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        approved_at INTEGER,
        rejected_at INTEGER,
        posted_at INTEGER,
        FOREIGN KEY (wake_id) REFERENCES herald_wakes(id)
      );
      CREATE INDEX IF NOT EXISTS herald_board_tenant_state
        ON herald_board_items (tenant_id, state, created_at DESC);

      CREATE TABLE IF NOT EXISTS herald_filings (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        memory_citation TEXT,
        commit_receipt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS herald_filings_tenant_created
        ON herald_filings (tenant_id, created_at DESC);
    `);
  }

  approveBriefing(input: {
    tenantId: string;
    content: HeraldBriefingContent;
    cadenceMinutes: number;
    proposalCount?: number;
  }, now: number = Date.now()): { briefing: HeraldBriefing; receipt: HeraldMutationReceipt } {
    const tenantId = requireText(input.tenantId, "tenantId");
    const cadenceMinutes = normalizeCadence(input.cadenceMinutes);
    const proposalCount = normalizeProposalCount(input.proposalCount);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.db
        .prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM herald_briefings WHERE tenant_id=?`)
        .get(tenantId) as { version: number };
      const version = Number(current.version) + 1;
      this.db.prepare(`
        INSERT INTO herald_briefings (
          tenant_id, version, content_json, cadence_minutes, proposal_count, approved_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(tenantId, version, JSON.stringify(input.content), cadenceMinutes, proposalCount, now, now);
      this.db.exec("COMMIT");
      const briefing = this.getApprovedBriefing(tenantId)!;
      return {
        briefing,
        receipt: {
          status: "ok",
          code: "briefing_approved",
          message: `Briefing v${version} approved; Herald may now loop every ${cadenceMinutes} minutes.`,
          tenantId,
        },
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getApprovedBriefing(tenantId: string): HeraldBriefing | null {
    const row = this.db.prepare(`
      SELECT * FROM herald_briefings WHERE tenant_id=? ORDER BY version DESC LIMIT 1
    `).get(requireText(tenantId, "tenantId")) as BriefingRow | undefined;
    return row ? briefingFromRow(row) : null;
  }

  listApprovedTenantIds(): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT tenant_id FROM herald_briefings ORDER BY tenant_id
    `).all() as unknown as Array<{ tenant_id: string }>;
    return rows.map((row) => row.tenant_id);
  }

  createProposals(tenantId: string, wakeId: string, proposals: HeraldProposalInput[], now: number = Date.now()): {
    items: HeraldBoardItem[];
    receipt: HeraldMutationReceipt;
  } {
    const normalizedTenant = requireText(tenantId, "tenantId");
    if (proposals.length > HERALD_MAX_PROPOSAL_COUNT) {
      throw new Error(`a wake cannot create more than ${HERALD_MAX_PROPOSAL_COUNT} proposals`);
    }
    const ids: string[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const statement = this.db.prepare(`
        INSERT INTO herald_board_items (
          id, tenant_id, wake_id, state, text, rationale, memory_citation, created_at, updated_at
        ) VALUES (?, ?, ?, 'proposed', ?, ?, ?, ?, ?)
      `);
      for (const proposal of proposals) {
        const id = randomUUID();
        statement.run(
          id,
          normalizedTenant,
          wakeId,
          requireText(proposal.text, "proposal text"),
          requireText(proposal.rationale, "proposal rationale"),
          requireText(proposal.memoryCitation, "proposal memory citation"),
          now,
          now,
        );
        ids.push(id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return {
      items: ids.map((id) => this.getBoardItem(normalizedTenant, id)!),
      receipt: {
        status: "ok",
        code: "proposals_created",
        message: `${ids.length} substantiated proposal${ids.length === 1 ? "" : "s"} added to the board.`,
        tenantId: normalizedTenant,
        ids,
      },
    };
  }

  listBoardItems(tenantId: string, states?: HeraldBoardState[]): HeraldBoardItem[] {
    const normalizedTenant = requireText(tenantId, "tenantId");
    if (states && states.length > 0) {
      const placeholders = states.map(() => "?").join(", ");
      const rows = this.db.prepare(`
        SELECT * FROM herald_board_items
        WHERE tenant_id=? AND state IN (${placeholders})
        ORDER BY created_at ASC, id ASC
      `).all(normalizedTenant, ...states) as unknown as BoardRow[];
      return rows.map(boardFromRow);
    }
    const rows = this.db.prepare(`
      SELECT * FROM herald_board_items WHERE tenant_id=? ORDER BY created_at ASC, id ASC
    `).all(normalizedTenant) as unknown as BoardRow[];
    return rows.map(boardFromRow);
  }

  getBoardItem(tenantId: string, itemId: string): HeraldBoardItem | null {
    const row = this.db.prepare(`
      SELECT * FROM herald_board_items WHERE tenant_id=? AND id=?
    `).get(requireText(tenantId, "tenantId"), requireText(itemId, "itemId")) as BoardRow | undefined;
    return row ? boardFromRow(row) : null;
  }

  countProposed(tenantId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM herald_board_items WHERE tenant_id=? AND state='proposed'
    `).get(requireText(tenantId, "tenantId")) as { count: number | bigint };
    return Number(row.count);
  }

  approveItems(tenantId: string, itemIds: string[], now: number = Date.now()): HeraldMutationReceipt {
    return this.transitionItems(tenantId, itemIds, "proposed", "approved", now);
  }

  rejectItems(tenantId: string, itemIds: string[], now: number = Date.now()): HeraldMutationReceipt {
    return this.transitionItems(tenantId, itemIds, "proposed", "rejected", now);
  }

  markPosted(tenantId: string, itemId: string, permalink: string, now: number = Date.now()): HeraldMutationReceipt {
    const normalizedTenant = requireText(tenantId, "tenantId");
    const normalizedPermalink = requireText(permalink, "permalink");
    const result = this.db.prepare(`
      UPDATE herald_board_items
      SET state='posted', permalink=?, posted_at=?, updated_at=?
      WHERE tenant_id=? AND id=? AND state='approved'
    `).run(normalizedPermalink, now, now, normalizedTenant, requireText(itemId, "itemId"));
    if (Number(result.changes) !== 1) {
      return { status: "error", code: "invalid_board_transition", message: "Only an approved item can be posted.", tenantId: normalizedTenant };
    }
    return {
      status: "ok",
      code: "item_posted",
      message: `Posted with canonical permalink receipt: ${normalizedPermalink}`,
      tenantId: normalizedTenant,
      ids: [itemId],
    };
  }

  recordFiling(input: Omit<HeraldFiling, "id" | "createdAt">, now: number = Date.now()): {
    filing: HeraldFiling;
    receipt: HeraldMutationReceipt;
  } {
    const id = randomUUID();
    const tenantId = requireText(input.tenantId, "tenantId");
    this.db.prepare(`
      INSERT INTO herald_filings (id, tenant_id, kind, content, memory_citation, commit_receipt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      tenantId,
      requireText(input.kind, "filing kind"),
      requireText(input.content, "filing content"),
      input.memoryCitation?.trim() || null,
      requireText(input.commitReceipt, "commit receipt"),
      now,
    );
    const filing = this.listFilings(tenantId).find((entry) => entry.id === id)!;
    return {
      filing,
      receipt: {
        status: "ok",
        code: "filing_recorded",
        message: `Filed ${filing.kind} to memory (${filing.commitReceipt}).`,
        tenantId,
        ids: [id],
      },
    };
  }

  listFilings(tenantId: string): HeraldFiling[] {
    const rows = this.db.prepare(`
      SELECT * FROM herald_filings WHERE tenant_id=? ORDER BY created_at ASC, id ASC
    `).all(requireText(tenantId, "tenantId")) as unknown as FilingRow[];
    return rows.map(filingFromRow);
  }

  tryStartWake(tenantId: string, source: HeraldWakeSource, now: number = Date.now()): string | null {
    const id = randomUUID();
    try {
      this.db.prepare(`
        INSERT INTO herald_wakes (id, tenant_id, source, status, created_at)
        VALUES (?, ?, ?, 'running', ?)
      `).run(id, requireText(tenantId, "tenantId"), source, now);
      return id;
    } catch (error) {
      if (String(error).includes("UNIQUE constraint failed")) return null;
      throw error;
    }
  }

  recordTerminalWake(input: {
    tenantId: string;
    source: HeraldWakeSource;
    status: Exclude<HeraldWakeStatus, "running" | "completed">;
    code: HeraldWakeReceipt["code"];
    message: string;
  }, now: number = Date.now()): HeraldWakeReceipt {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO herald_wakes (
        id, tenant_id, source, status, code, message, proposal_ids_json, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?)
    `).run(id, requireText(input.tenantId, "tenantId"), input.source, input.status, input.code, input.message, now, now);
    return this.getWakeReceipt(id)!;
  }

  finishWake(wakeId: string, input: {
    status: "completed" | "failed";
    code: HeraldWakeReceipt["code"];
    message: string;
    proposalIds?: string[];
  }, now: number = Date.now()): HeraldWakeReceipt {
    const result = this.db.prepare(`
      UPDATE herald_wakes
      SET status=?, code=?, message=?, proposal_ids_json=?, completed_at=?
      WHERE id=? AND status='running'
    `).run(input.status, input.code, input.message, JSON.stringify(input.proposalIds ?? []), now, requireText(wakeId, "wakeId"));
    if (Number(result.changes) !== 1) throw new Error(`wake ${wakeId} is not running`);
    return this.getWakeReceipt(wakeId)!;
  }

  getWakeReceipt(wakeId: string): HeraldWakeReceipt | null {
    const row = this.db.prepare(`SELECT * FROM herald_wakes WHERE id=?`).get(wakeId) as WakeRow | undefined;
    return row ? wakeFromRow(row) : null;
  }

  recentWakeReceipts(tenantId: string, limit = 25): HeraldWakeReceipt[] {
    const rows = this.db.prepare(`
      SELECT * FROM herald_wakes
      WHERE tenant_id=? AND status <> 'running'
      ORDER BY created_at DESC LIMIT ?
    `).all(requireText(tenantId, "tenantId"), limit) as unknown as WakeRow[];
    return rows.map(wakeFromRow).filter((receipt): receipt is HeraldWakeReceipt => receipt !== null);
  }

  latestScheduledWakeAt(tenantId: string): number | null {
    const row = this.db.prepare(`
      SELECT MAX(created_at) AS created_at FROM herald_wakes
      WHERE tenant_id=? AND source='scheduled'
    `).get(requireText(tenantId, "tenantId")) as { created_at: number | null };
    return row.created_at === null ? null : Number(row.created_at);
  }

  close(): void {
    this.db.close();
  }

  private transitionItems(
    tenantId: string,
    itemIds: string[],
    from: "proposed",
    to: "approved" | "rejected",
    now: number,
  ): HeraldMutationReceipt {
    const normalizedTenant = requireText(tenantId, "tenantId");
    const ids = [...new Set(itemIds.map((id) => requireText(id, "itemId")))];
    if (ids.length === 0) {
      return { status: "error", code: "no_board_items", message: "No board items were selected.", tenantId: normalizedTenant };
    }
    const timestampColumn = to === "approved" ? "approved_at" : "rejected_at";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const statement = this.db.prepare(`
        UPDATE herald_board_items SET state=?, ${timestampColumn}=?, updated_at=?
        WHERE tenant_id=? AND id=? AND state=?
      `);
      for (const id of ids) {
        const result = statement.run(to, now, now, normalizedTenant, id, from);
        if (Number(result.changes) !== 1) throw new Error(`board item ${id} is not ${from} for this tenant`);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      return {
        status: "error",
        code: "invalid_board_transition",
        message: error instanceof Error ? error.message : String(error),
        tenantId: normalizedTenant,
      };
    }
    return {
      status: "ok",
      code: `items_${to}`,
      message: `${ids.length} item${ids.length === 1 ? "" : "s"} ${to}.`,
      tenantId: normalizedTenant,
      ids,
    };
  }
}

export interface HeraldWakeHandlerInput {
  tenantId: string;
  wakeId: string;
  source: HeraldWakeSource;
  briefing: HeraldBriefing;
  proposalCount: number;
}

export interface HeraldLoopSchedulerOptions {
  now?: () => number;
  tickIntervalMs?: number;
  runWake: (input: HeraldWakeHandlerInput) => Promise<HeraldProposalInput[]>;
  /** Must bridge to the ported Ring chat. It is called for every terminal path. */
  onReceipt: (receipt: HeraldWakeReceipt) => void | Promise<void>;
  log?: Pick<Console, "info" | "error">;
}

/** One shared execution path for both cadence ticks and the dashboard Run-now action. */
export class HeraldLoopScheduler {
  private readonly now: () => number;
  private readonly tickIntervalMs: number;
  private readonly log: Pick<Console, "info" | "error">;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: HeraldLoopStore,
    private readonly options: HeraldLoopSchedulerOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.tickIntervalMs = options.tickIntervalMs ?? 30_000;
    this.log = options.log ?? console;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) => this.log.error("[herald-loop] scheduler tick failed", error));
    }, this.tickIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<HeraldWakeReceipt[]> {
    const now = this.now();
    const due = this.store.listApprovedTenantIds().filter((tenantId) => this.isScheduledDue(tenantId, now));
    return Promise.all(due.map((tenantId) => this.runTenant(tenantId, "scheduled")));
  }

  runNow(tenantId: string): Promise<HeraldWakeReceipt> {
    return this.runTenant(tenantId, "run_now");
  }

  async runTenant(tenantId: string, source: HeraldWakeSource): Promise<HeraldWakeReceipt> {
    const now = this.now();
    const briefing = this.store.getApprovedBriefing(tenantId);
    if (!briefing) {
      return this.emit(this.store.recordTerminalWake({
        tenantId,
        source,
        status: "refused",
        code: "briefing_required",
        message: "Herald refused to wake: no approved briefing. Approve the briefing with ✓ before looping.",
      }, now));
    }

    if (source === "scheduled" && !this.isScheduledDue(tenantId, now)) {
      return this.emit(this.store.recordTerminalWake({
        tenantId,
        source,
        status: "skipped",
        code: "cadence_throttled",
        message: `Herald skipped this wake: the ${briefing.cadenceMinutes}-minute cadence has not elapsed.`,
      }, now));
    }

    const open = this.store.countProposed(tenantId);
    if (open >= briefing.proposalCount) {
      return this.emit(this.store.recordTerminalWake({
        tenantId,
        source,
        status: "skipped",
        code: "proposal_pileup",
        message: `Herald skipped this wake: ${open} proposals still await approval (limit ${briefing.proposalCount}).`,
      }, now));
    }

    const wakeId = this.store.tryStartWake(tenantId, source, now);
    if (!wakeId) {
      return this.emit(this.store.recordTerminalWake({
        tenantId,
        source,
        status: "skipped",
        code: "wake_in_progress",
        message: "Herald skipped this wake: another wake for this tenant is still running.",
      }, now));
    }

    try {
      const proposed = await this.options.runWake({
        tenantId,
        wakeId,
        source,
        briefing,
        proposalCount: briefing.proposalCount,
      });
      const proposals = proposed.slice(0, HERALD_MAX_PROPOSAL_COUNT);
      const { items } = this.store.createProposals(tenantId, wakeId, proposals, this.now());
      return this.emit(this.store.finishWake(wakeId, {
        status: "completed",
        code: "wake_completed",
        message: `Herald wake completed with ${items.length} substantiated proposal${items.length === 1 ? "" : "s"}.`,
        proposalIds: items.map((item) => item.id),
      }, this.now()));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.emit(this.store.finishWake(wakeId, {
        status: "failed",
        code: "wake_failed",
        message: `Herald wake failed loudly: ${message}`,
      }, this.now()));
    }
  }

  private isScheduledDue(tenantId: string, now: number): boolean {
    const briefing = this.store.getApprovedBriefing(tenantId);
    if (!briefing) return false;
    const anchor = this.store.latestScheduledWakeAt(tenantId) ?? briefing.approvedAt;
    return now >= anchor + briefing.cadenceMinutes * 60_000;
  }

  private async emit(receipt: HeraldWakeReceipt): Promise<HeraldWakeReceipt> {
    this.log.info(`[herald-loop] ${receipt.tenantId} ${receipt.code}: ${receipt.message}`);
    await this.options.onReceipt(receipt);
    return receipt;
  }
}
