import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  isCaptureMemoryTool,
  type CaptureMemoryTool,
} from "./captureMemoryAuthority.js";

export interface CaptureTicketDelivery {
  tenantId: string;
  surface: "whatsapp" | "telegram";
  conversationKey: string;
  providerMessageId: string;
  jobId: string;
  memoryAuthorityId: string;
  captureTool: CaptureMemoryTool;
}

interface CaptureTicketRow {
  tenant_id: string;
  surface: "whatsapp" | "telegram";
  conversation_key: string;
  provider_message_id: string;
  job_id: string;
  memory_authority_id: string;
  capture_tool: CaptureMemoryTool;
}

interface CaptureJobAuthority {
  tenantId: string;
  jobId: string;
  memoryAuthorityId: string;
  captureTool: CaptureMemoryTool;
}

/**
 * Durable Phylax-side producer for Ring capture context.
 *
 * Observing an accepted capture only records correlation. Ring remains the
 * verifier: delivery succeeds only after Ring independently reads the canonical
 * job as terminal and extracts its evidenceRef. Failed/nonterminal deliveries
 * remain pending for the next terminal callback or process restart.
 */
export class RingCaptureTicketProducer {
  private readonly db: DatabaseSync;
  private drainPromise: Promise<void> | null = null;
  private wakeRequested = false;
  private closed = false;

  constructor(
    path: string,
    private readonly deliver: (ticket: CaptureTicketDelivery) => Promise<"recorded" | "duplicate" | "pending">,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 30000;
    `);
    this.ensureJobAuthoritySchema();
    this.ensureOutboxSchema();
  }

  private ensureJobAuthoritySchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ring_capture_job_authorities (
        tenant_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        memory_authority_id TEXT NOT NULL,
        capture_tool TEXT NOT NULL CHECK (capture_tool IN ('store_memory', 'ingest_memory')),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, job_id)
      );
    `);
  }

  private ensureOutboxSchema(): void {
    const table = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ring_capture_ticket_outbox'",
    ).get() as { name?: string } | undefined;
    if (!table) {
      this.createOutboxTable();
      return;
    }
    const columns = this.db.prepare("PRAGMA table_info(ring_capture_ticket_outbox)").all() as unknown as Array<{
      name: string;
      pk: number;
    }>;
    const primaryKey = columns
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((column) => column.name);
    if (
      columns.some((column) => column.name === "provider_message_id") &&
      columns.some((column) => column.name === "memory_authority_id") &&
      columns.some((column) => column.name === "capture_tool") &&
      columns.some((column) => column.name === "terminal_at") &&
      primaryKey.join(",") === "tenant_id,surface,conversation_key,provider_message_id"
    ) {
      this.createPendingIndex();
      return;
    }

    const names = new Set(columns.map((column) => column.name));
    const providerColumn = names.has("provider_message_id") ? "provider_message_id" : "capture_id";
    const authorityColumn = names.has("memory_authority_id") ? "memory_authority_id" : "NULL";
    const captureToolColumn = names.has("capture_tool") ? "capture_tool" : "NULL";
    const terminalColumn = names.has("terminal_at") ? "terminal_at" : "NULL";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        DROP INDEX IF EXISTS idx_ring_capture_ticket_pending;
        ALTER TABLE ring_capture_ticket_outbox RENAME TO ring_capture_ticket_outbox_legacy;
      `);
      this.createOutboxTable(false);
      this.db.exec(
        `
        INSERT OR IGNORE INTO ring_capture_ticket_outbox (
          tenant_id, surface, conversation_key, provider_message_id, job_id,
          memory_authority_id, capture_tool, terminal_at,
          delivered_at, last_error, created_at, updated_at
        )
        SELECT tenant_id, surface, conversation_key, ${providerColumn}, job_id,
               ${authorityColumn}, ${captureToolColumn}, ${terminalColumn},
               delivered_at, last_error, created_at, updated_at
        FROM ring_capture_ticket_outbox_legacy;
        DROP TABLE ring_capture_ticket_outbox_legacy;
        CREATE INDEX idx_ring_capture_ticket_pending
          ON ring_capture_ticket_outbox(delivered_at, terminal_at, created_at);
        COMMIT;
        `,
      );
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private createOutboxTable(withIndex = true): void {
    this.db.exec(`
      CREATE TABLE ring_capture_ticket_outbox (
        tenant_id TEXT NOT NULL,
        surface TEXT NOT NULL CHECK (surface IN ('whatsapp', 'telegram')),
        conversation_key TEXT NOT NULL,
        provider_message_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        memory_authority_id TEXT,
        capture_tool TEXT CHECK (capture_tool IN ('store_memory', 'ingest_memory')),
        terminal_at INTEGER,
        delivered_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, surface, conversation_key, provider_message_id)
      );
    `);
    if (withIndex) this.createPendingIndex();
  }

  private createPendingIndex(): void {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ring_capture_ticket_pending
        ON ring_capture_ticket_outbox(delivered_at, terminal_at, created_at);
    `);
  }

  bindMemoryJob(binding: CaptureJobAuthority): void {
    if (this.closed) throw new Error("Ring capture ticket producer is closed");
    const tenantId = binding.tenantId.trim();
    const jobId = binding.jobId.trim();
    const memoryAuthorityId = binding.memoryAuthorityId.trim();
    if (!tenantId || !jobId || !/^memory-authority-v1:[0-9a-f]{64}$/.test(memoryAuthorityId)) {
      throw new Error("capture memory authority binding is invalid");
    }
    if (!isCaptureMemoryTool(binding.captureTool)) {
      throw new Error("capture memory tool binding is invalid");
    }
    this.db.prepare(
      `INSERT INTO ring_capture_job_authorities (
         tenant_id, job_id, memory_authority_id, capture_tool, created_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, job_id) DO NOTHING`,
    ).run(tenantId, jobId, memoryAuthorityId, binding.captureTool, Date.now());
    const stored = this.memoryJobAuthority(tenantId, jobId);
    if (
      !stored
      || stored.memoryAuthorityId !== memoryAuthorityId
      || stored.captureTool !== binding.captureTool
    ) {
      throw new Error("capture job authority changed for an existing tenant job");
    }
  }

  observe(ticket: CaptureTicketDelivery): void {
    if (this.closed) throw new Error("Ring capture ticket producer is closed");
    this.bindMemoryJob(ticket);
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO ring_capture_ticket_outbox (
         tenant_id, surface, conversation_key, provider_message_id, job_id,
         memory_authority_id, capture_tool, terminal_at,
         delivered_at, last_error, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
       ON CONFLICT (tenant_id, surface, conversation_key, provider_message_id) DO UPDATE SET
         memory_authority_id=COALESCE(ring_capture_ticket_outbox.memory_authority_id, excluded.memory_authority_id),
         capture_tool=COALESCE(ring_capture_ticket_outbox.capture_tool, excluded.capture_tool),
         updated_at=excluded.updated_at
       WHERE ring_capture_ticket_outbox.job_id=excluded.job_id
         AND (
           ring_capture_ticket_outbox.memory_authority_id IS NULL
           OR ring_capture_ticket_outbox.memory_authority_id=excluded.memory_authority_id
         )
         AND (
           ring_capture_ticket_outbox.capture_tool IS NULL
           OR ring_capture_ticket_outbox.capture_tool=excluded.capture_tool
         )`,
    ).run(
      ticket.tenantId,
      ticket.surface,
      ticket.conversationKey,
      ticket.providerMessageId,
      ticket.jobId,
      ticket.memoryAuthorityId,
      ticket.captureTool,
      now,
      now,
    );
    const stored = this.db.prepare(
      `SELECT job_id, memory_authority_id, capture_tool
       FROM ring_capture_ticket_outbox
       WHERE tenant_id=? AND surface=? AND conversation_key=? AND provider_message_id=?`,
    ).get(
      ticket.tenantId,
      ticket.surface,
      ticket.conversationKey,
      ticket.providerMessageId,
    ) as {
      job_id: string;
      memory_authority_id: string | null;
      capture_tool: CaptureMemoryTool | null;
    } | undefined;
    if (
      !stored
      || stored.job_id !== ticket.jobId
      || stored.memory_authority_id !== ticket.memoryAuthorityId
      || stored.capture_tool !== ticket.captureTool
    ) {
      throw new Error("capture identity changed for an existing Ring ticket");
    }
  }

  observeJob(
    ticket: Omit<CaptureTicketDelivery, "memoryAuthorityId" | "captureTool">,
    terminal = false,
  ): boolean {
    const authority = this.memoryJobAuthority(ticket.tenantId, ticket.jobId);
    if (!authority) return false;
    this.observe({ ...ticket, ...authority });
    if (terminal) this.markTerminal(ticket);
    return true;
  }

  private markTerminal(
    ticket: Pick<CaptureTicketDelivery, "tenantId" | "surface" | "conversationKey" | "providerMessageId">,
  ): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE ring_capture_ticket_outbox
       SET terminal_at=COALESCE(terminal_at, ?), updated_at=?
       WHERE tenant_id=? AND surface=? AND conversation_key=? AND provider_message_id=?`,
    ).run(
      now,
      now,
      ticket.tenantId,
      ticket.surface,
      ticket.conversationKey,
      ticket.providerMessageId,
    );
    this.requestDrain();
  }

  resume(): void {
    if (!this.closed) this.requestDrain();
  }

  /**
   * Restart reconciliation for the crash window between Phylax's authoritative
   * accepted-job commit and the runtime callback that normally mirrors it here.
   * This imports correlation only; Ring still verifies terminal authority.
   */
  recoverFromCaptureJournal(path: string): void {
    if (this.closed) throw new Error("Ring capture ticket producer is closed");
    let source: DatabaseSync;
    try {
      source = new DatabaseSync(path, { readOnly: true });
    } catch {
      return;
    }
    try {
      const rows = source.prepare(
        `SELECT tenant_id, channel, provider_message_id, conversation_key, job_id, tool, state
         FROM phylax_capture_jobs
         WHERE state IN ('polling', 'done')
         ORDER BY created_at`,
      ).all() as unknown as Array<{
        tenant_id: string;
        channel: "whatsapp" | "telegram";
        provider_message_id: string;
        conversation_key: string;
        job_id: string;
        tool: string;
        state: "polling" | "done";
      }>;
      for (const row of rows) {
        if (!isCaptureMemoryTool(row.tool)) continue;
        const authority = this.memoryJobAuthority(row.tenant_id, row.job_id);
        if (!authority || authority.captureTool !== row.tool) continue;
        this.observe({
          tenantId: row.tenant_id,
          surface: row.channel,
          conversationKey: row.conversation_key,
          providerMessageId: row.provider_message_id,
          jobId: row.job_id,
          ...authority,
        });
        if (row.state === "done") {
          this.markTerminal({
            tenantId: row.tenant_id,
            surface: row.channel,
            conversationKey: row.conversation_key,
            providerMessageId: row.provider_message_id,
          });
        }
      }
    } catch {
      // Older/empty installations have no capture journal to reconcile.
    } finally {
      source.close();
    }
  }

  /** Test/controlled-shutdown seam: wait for the current bounded delivery lap. */
  async flush(): Promise<void> {
    const active = this.drainPromise;
    if (!active) return;
    await active;
    if (this.drainPromise && this.drainPromise !== active) await this.flush();
  }

  private requestDrain(): void {
    if (this.closed) return;
    if (this.drainPromise) {
      this.wakeRequested = true;
      return;
    }
    this.wakeRequested = false;
    const active = this.drain();
    this.drainPromise = active;
    void active.finally(() => {
      if (this.drainPromise === active) {
        this.drainPromise = null;
        if (this.wakeRequested) this.requestDrain();
      }
    });
  }

  private pending(): CaptureTicketDelivery[] {
    const rows = this.db.prepare(
      `SELECT tenant_id, surface, conversation_key, provider_message_id, job_id,
              memory_authority_id, capture_tool
       FROM ring_capture_ticket_outbox
       WHERE delivered_at IS NULL
         AND terminal_at IS NOT NULL
         AND memory_authority_id IS NOT NULL
         AND capture_tool IS NOT NULL
       ORDER BY created_at, tenant_id, surface, conversation_key, provider_message_id`,
    ).all() as unknown as CaptureTicketRow[];
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      surface: row.surface,
      conversationKey: row.conversation_key,
      providerMessageId: row.provider_message_id,
      jobId: row.job_id,
      memoryAuthorityId: row.memory_authority_id,
      captureTool: row.capture_tool,
    }));
  }

  private memoryJobAuthority(tenantId: string, jobId: string): Omit<
    CaptureJobAuthority,
    "tenantId" | "jobId"
  > | null {
    const row = this.db.prepare(
      `SELECT memory_authority_id, capture_tool
       FROM ring_capture_job_authorities
       WHERE tenant_id=? AND job_id=?`,
    ).get(tenantId, jobId) as {
      memory_authority_id: string;
      capture_tool: CaptureMemoryTool;
    } | undefined;
    return row
      ? {
          memoryAuthorityId: row.memory_authority_id,
          captureTool: row.capture_tool,
        }
      : null;
  }

  private async drain(): Promise<void> {
    // One bounded pass. A nonterminal authority result is expected and remains
    // pending until a later capture callback or restart explicitly wakes us.
    for (const ticket of this.pending()) {
      if (this.closed) return;
      try {
        const status = await this.deliver(ticket);
        if (status === "pending") continue;
        this.db.prepare(
          `UPDATE ring_capture_ticket_outbox
           SET delivered_at=?, last_error=NULL, updated_at=?
           WHERE tenant_id=? AND surface=? AND conversation_key=?
             AND provider_message_id=? AND delivered_at IS NULL`,
        ).run(
          Date.now(),
          Date.now(),
          ticket.tenantId,
          ticket.surface,
          ticket.conversationKey,
          ticket.providerMessageId,
        );
      } catch (error) {
        this.db.prepare(
          `UPDATE ring_capture_ticket_outbox
           SET last_error=?, updated_at=?
           WHERE tenant_id=? AND surface=? AND conversation_key=?
             AND provider_message_id=? AND delivered_at IS NULL`,
        ).run(
          error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          Date.now(),
          ticket.tenantId,
          ticket.surface,
          ticket.conversationKey,
          ticket.providerMessageId,
        );
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.drainPromise;
    this.db.close();
  }
}
