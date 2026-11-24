import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WAMessage, WAMessageKey } from "@whiskeysockets/baileys";

import { normalizeWhatsAppIdentifier } from "./whatsappConfig.js";
import type { SocketFactory, SocketLike } from "./whatsappGateway.js";

/**
 * EPIC-20 A9 (agent_team E60-A2/E60-S18): more WhatsApp numbers on one Zenod account. Each extra number is its own
 * Baileys session in `<whatsapp root>/sessions/<sessionId>/`, beside the default Zenod number's `session/` (which this
 * pool never touches). A session belongs to one tenant; only that tenant may pair, list, send from or remove it.
 * Inbound messages on an extra number go through the same gateway path as the default number, tagged with the number
 * they were sent TO, so Zenod can tell the subscriber which number received a note.
 */

export type WhatsAppExtraSessionState = "starting" | "pairing" | "connected" | "reconnecting" | "disconnected" | "logged_out";

export interface WhatsAppExtraSessionView {
  sessionId: string;
  tenantId: string;
  label: string | null;
  state: WhatsAppExtraSessionState;
  /** The paired number in full (`+<digits>`); it is this account's own number. Null until paired. */
  number: string | null;
  /** The raw WhatsApp pairing QR payload while pairing; render it as a QR code and scan it from the phone. */
  qr: string | null;
  lastError: string | null;
  createdAt: string;
  connectedAt: string | null;
}

export interface WhatsAppSessionOrigin {
  sessionId: string;
  /** `+<digits>` of the number the message was sent to, when known. */
  toNumber: string | null;
}

interface SessionMeta {
  sessionId: string;
  tenantId: string;
  label: string | null;
  createdAt: string;
}

interface SessionEntry {
  meta: SessionMeta;
  socket: SocketLike | null;
  state: WhatsAppExtraSessionState;
  qr: string | null;
  number: string | null;
  lastError: string | null;
  connectedAt: number | null;
  generation: number;
  reconnectTimer: NodeJS.Timeout | null;
  failures: number;
  waiters: Set<() => void>;
}

export interface WhatsAppSessionHandlers {
  onMessages(origin: WhatsAppSessionOrigin, messages: WAMessage[], type: string): Promise<void>;
  onReceipts?(updates: Array<{ key: WAMessageKey; update: { status?: number | null } }>): void;
}

export class WhatsAppSessionError extends Error {
  constructor(readonly code: "not_found" | "limit" | "not_connected" | "invalid_input", message: string) {
    super(message);
  }
}

const SESSION_ID = /^wa_[a-f0-9]{12}$/;
const META_FILE = "meta.json";
const CREDS_FILE = "creds.json";
/** Baileys DisconnectReason: loggedOut 401, restartRequired 515 (sent once right after a QR scan). */
const LOGGED_OUT = 401;
const RESTART_REQUIRED = 515;

function statusCodeOf(update: Record<string, unknown>): number {
  return Number(
    (update.lastDisconnect as { error?: { output?: { statusCode?: unknown } } } | undefined)?.error?.output?.statusCode,
  );
}

function fullNumber(jid: string | null | undefined): string | null {
  const digits = normalizeWhatsAppIdentifier(jid ?? "");
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}

export class WhatsAppSessionPool {
  private readonly sessions = new Map<string, SessionEntry>();
  private handlers: WhatsAppSessionHandlers | null = null;
  private closed = false;

  constructor(
    private readonly options: {
      /** The WhatsApp data root (the default session lives in `<root>/session`). */
      root: string;
      socketFactory: SocketFactory;
      /** Extra numbers one tenant may hold, besides the shared default number. */
      maxPerTenant?: number;
      reconnectDelayMs?: number;
      maxReconnectDelayMs?: number;
      log?: (line: string) => void;
    },
  ) {}

  get sessionsRoot(): string {
    return join(this.options.root, "sessions");
  }

  sessionDir(sessionId: string): string {
    if (!SESSION_ID.test(sessionId)) throw new WhatsAppSessionError("invalid_input", "invalid WhatsApp session id");
    return join(this.sessionsRoot, sessionId);
  }

  attach(handlers: WhatsAppSessionHandlers): void {
    this.handlers = handlers;
  }

  /** Reconnect every stored session that was paired before (has credentials). Sessions never paired stay idle. */
  async startAll(): Promise<void> {
    let names: string[] = [];
    try {
      names = await readdir(this.sessionsRoot);
    } catch {
      return;
    }
    for (const name of names) {
      if (!SESSION_ID.test(name)) continue;
      const meta = await this.readMeta(name);
      if (!meta || this.sessions.has(name)) continue;
      const entry = this.entry(meta);
      if (await this.hasCredentials(name)) {
        await this.connect(entry).catch((error: unknown) => this.fail(entry, error));
      } else {
        entry.state = "disconnected";
      }
    }
  }

  /**
   * Start pairing a new number for a tenant, or (with sessionId) restart pairing for one of its sessions that is not
   * connected. Resolves once WhatsApp gave a QR, the session connected, or `waitMs` passed.
   */
  async pair(tenantId: string, input: { label?: string | null; sessionId?: string | null } = {}, waitMs = 15_000): Promise<WhatsAppExtraSessionView> {
    if (!tenantId.trim()) throw new WhatsAppSessionError("invalid_input", "tenant is required");
    let entry: SessionEntry;
    if (input.sessionId) {
      entry = this.owned(tenantId, input.sessionId);
      if (entry.state === "connected") return this.view(entry);
      this.stop(entry);
    } else {
      const max = this.options.maxPerTenant ?? 4;
      if (this.list(tenantId).length >= max) {
        throw new WhatsAppSessionError("limit", `This account already has ${max} extra WhatsApp numbers; remove one first.`);
      }
      const meta: SessionMeta = {
        sessionId: `wa_${randomBytes(6).toString("hex")}`,
        tenantId,
        label: input.label?.trim().slice(0, 60) || null,
        createdAt: new Date().toISOString(),
      };
      await mkdir(this.sessionDir(meta.sessionId), { recursive: true, mode: 0o700 });
      await writeFile(join(this.sessionDir(meta.sessionId), META_FILE), JSON.stringify(meta), { mode: 0o600 });
      entry = this.entry(meta);
    }
    await this.connect(entry);
    await this.waitFor(entry, () => entry.state === "pairing" || entry.state === "connected" || entry.state === "disconnected" || entry.state === "logged_out", waitMs);
    return this.view(entry);
  }

  list(tenantId?: string): WhatsAppExtraSessionView[] {
    return [...this.sessions.values()]
      .filter((entry) => !tenantId || entry.meta.tenantId === tenantId)
      .map((entry) => this.view(entry));
  }

  get(tenantId: string, sessionId: string): WhatsAppExtraSessionView {
    return this.view(this.owned(tenantId, sessionId));
  }

  /**
   * The tenant's connected session matching `from` (a session id or its number in any common format). Throws when the
   * tenant has no such number or it is not connected now.
   */
  resolve(tenantId: string, from: string): { sessionId: string; number: string | null; socket: SocketLike } {
    const wanted = from.trim();
    const digits = normalizeWhatsAppIdentifier(wanted);
    const entry = [...this.sessions.values()].find((candidate) =>
      candidate.meta.tenantId === tenantId
      && (candidate.meta.sessionId === wanted || (digits && candidate.number === `+${digits}`)));
    if (!entry) throw new WhatsAppSessionError("not_found", "That WhatsApp number is not paired to this Zenod account.");
    if (entry.state !== "connected" || !entry.socket) {
      throw new WhatsAppSessionError("not_connected", `That WhatsApp number is ${entry.state}; it cannot send right now.`);
    }
    return { sessionId: entry.meta.sessionId, number: entry.number, socket: entry.socket };
  }

  /** The connected socket of a session, or null (any tenant: used for replies on the number a message came in on). */
  socket(sessionId: string | null | undefined): SocketLike | null {
    if (!sessionId) return null;
    const entry = this.sessions.get(sessionId);
    return entry?.state === "connected" ? entry.socket : null;
  }

  tenantOf(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.meta.tenantId ?? null;
  }

  /** Unpair a tenant's number: log it out on WhatsApp when connected, then delete its stored session. */
  async remove(tenantId: string, sessionId: string): Promise<void> {
    const entry = this.owned(tenantId, sessionId);
    const socket = entry.socket;
    this.stop(entry);
    if (socket) {
      try {
        await (socket as SocketLike & { logout?: () => Promise<void> }).logout?.();
      } catch (error) {
        this.log(`[whatsapp:${sessionId}] logout failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.sessions.delete(sessionId);
    await rm(this.sessionDir(sessionId), { recursive: true, force: true });
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.sessions.values()].map(async (entry) => {
      const socket = entry.socket;
      this.stop(entry);
      try {
        await socket?.flushCredentials?.();
      } finally {
        socket?.end?.();
      }
    }));
  }

  private entry(meta: SessionMeta): SessionEntry {
    const entry: SessionEntry = {
      meta,
      socket: null,
      state: "starting",
      qr: null,
      number: null,
      lastError: null,
      connectedAt: null,
      generation: 0,
      reconnectTimer: null,
      failures: 0,
      waiters: new Set(),
    };
    this.sessions.set(meta.sessionId, entry);
    return entry;
  }

  private owned(tenantId: string, sessionId: string): SessionEntry {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.meta.tenantId !== tenantId) {
      throw new WhatsAppSessionError("not_found", "That WhatsApp number is not paired to this Zenod account.");
    }
    return entry;
  }

  private view(entry: SessionEntry): WhatsAppExtraSessionView {
    return {
      sessionId: entry.meta.sessionId,
      tenantId: entry.meta.tenantId,
      label: entry.meta.label,
      state: entry.state,
      number: entry.number,
      qr: entry.state === "pairing" ? entry.qr : null,
      lastError: entry.lastError,
      createdAt: entry.meta.createdAt,
      connectedAt: entry.connectedAt === null ? null : new Date(entry.connectedAt).toISOString(),
    };
  }

  private stop(entry: SessionEntry): void {
    entry.generation += 1;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
    const socket = entry.socket;
    entry.socket = null;
    entry.qr = null;
    socket?.end?.();
  }

  private async connect(entry: SessionEntry): Promise<void> {
    if (this.closed) return;
    const generation = ++entry.generation;
    entry.state = entry.connectedAt ? "reconnecting" : "starting";
    entry.lastError = null;
    this.wake(entry);
    const socket = await this.options.socketFactory(this.sessionDir(entry.meta.sessionId));
    if (this.closed || generation !== entry.generation) {
      socket.end?.();
      return;
    }
    entry.socket = socket;
    socket.ev.on("connection.update", (update) => {
      if (generation !== entry.generation) return;
      if (typeof update.qr === "string" && update.qr) {
        entry.qr = update.qr;
        entry.state = "pairing";
        this.wake(entry);
      }
      if (update.connection === "open") {
        entry.qr = null;
        entry.state = "connected";
        entry.failures = 0;
        entry.connectedAt = Date.now();
        entry.number = fullNumber(socket.user?.id) ?? entry.number;
        this.log(`[whatsapp:${entry.meta.sessionId}] connected`);
        this.wake(entry);
      }
      if (update.connection === "close") {
        const code = statusCodeOf(update);
        entry.socket = null;
        entry.qr = null;
        entry.generation += 1;
        void socket.flushCredentials?.().catch(() => undefined).finally(() => socket.end?.());
        if (code === LOGGED_OUT) {
          entry.state = "logged_out";
          entry.lastError = "WhatsApp logged this number out; pair it again.";
          this.wake(entry);
          return;
        }
        // Never paired and not the post-scan restart: the QR ran out. Stay idle until pairing is asked again.
        if (!entry.connectedAt && code !== RESTART_REQUIRED) {
          entry.state = "disconnected";
          entry.lastError = `pairing ended (code ${Number.isFinite(code) ? code : "unknown"}); ask for a new QR`;
          this.wake(entry);
          return;
        }
        this.scheduleReconnect(entry, code === RESTART_REQUIRED ? 0 : undefined);
      }
    });
    socket.ev.on("messages.upsert", (update) => {
      if (generation !== entry.generation || !this.handlers) return;
      const origin = { sessionId: entry.meta.sessionId, toNumber: entry.number ?? fullNumber(socket.user?.id) };
      void this.handlers.onMessages(origin, update.messages, update.type).catch((error: unknown) => {
        this.log(`[whatsapp:${entry.meta.sessionId}] message handler failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    socket.ev.on("messages.update", (updates) => {
      if (generation !== entry.generation) return;
      this.handlers?.onReceipts?.(updates);
    });
  }

  private scheduleReconnect(entry: SessionEntry, delayMs?: number): void {
    if (this.closed || entry.reconnectTimer) return;
    entry.state = "reconnecting";
    entry.failures += 1;
    const base = this.options.reconnectDelayMs ?? 2_000;
    const max = this.options.maxReconnectDelayMs ?? 60_000;
    const delay = delayMs ?? Math.min(max, base * 2 ** Math.min(entry.failures - 1, 6));
    this.wake(entry);
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      void this.connect(entry).catch((error: unknown) => this.fail(entry, error));
    }, delay);
    entry.reconnectTimer.unref?.();
  }

  private fail(entry: SessionEntry, error: unknown): void {
    entry.lastError = error instanceof Error ? error.message : String(error);
    this.log(`[whatsapp:${entry.meta.sessionId}] start failed: ${entry.lastError}`);
    if (entry.connectedAt) this.scheduleReconnect(entry);
    else {
      entry.state = "disconnected";
      this.wake(entry);
    }
  }

  private wake(entry: SessionEntry): void {
    for (const waiter of [...entry.waiters]) waiter();
  }

  private waitFor(entry: SessionEntry, done: () => boolean, timeoutMs: number): Promise<void> {
    if (done()) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        entry.waiters.delete(check);
        resolve();
      };
      const check = () => {
        if (done()) finish();
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref?.();
      entry.waiters.add(check);
    });
  }

  private async readMeta(sessionId: string): Promise<SessionMeta | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.sessionDir(sessionId), META_FILE), "utf8")) as Partial<SessionMeta>;
      if (raw.sessionId !== sessionId || typeof raw.tenantId !== "string" || !raw.tenantId) return null;
      return {
        sessionId,
        tenantId: raw.tenantId,
        label: typeof raw.label === "string" ? raw.label : null,
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
      };
    } catch {
      return null;
    }
  }

  private async hasCredentials(sessionId: string): Promise<boolean> {
    try {
      const raw = JSON.parse(await readFile(join(this.sessionDir(sessionId), CREDS_FILE), "utf8")) as { registered?: unknown; me?: unknown };
      return Boolean(raw.me) || raw.registered === true;
    } catch {
      return false;
    }
  }

  private log(line: string): void {
    (this.options.log ?? console.info)(line);
  }
}
