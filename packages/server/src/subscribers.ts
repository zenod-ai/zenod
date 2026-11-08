import { createHash, createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { DatabaseSync } from "node:sqlite";

import type { CredentialVault } from "./credentialVault.js";
import { openZenodSqlite } from "./sqlite.js";

/**
 * Subscribers (agent_team E42-S22, contract: agent_team docs/status/e42-s22-contract.md).
 *
 * Push, the other half of Connect / MCP (pull): apps that Zenod calls when a new voice note lands. Two kinds share one
 * list: an agent team connected with Sign in with Zenod (via "oauth", tied to a narrow `zvn_` grant) and a webhook a
 * developer added by hand (via "manual"). Each delivery is a signed pointer to the note, never its words; the app reads
 * the note with its own grant (or, for a hand webhook, the workspace's MCP token).
 *
 * Per tenant: `subscribers.sqlite` in the tenant data dir holds grants (token hash only), subscriptions and a 7-day
 * delivery log; each subscription's signing secret lives in the tenant credential vault (it must be recoverable to sign).
 * Off unless the operator sets ZENOD_SUBSCRIBERS=on: with it off nothing here is opened and no table is created.
 */

export const SUBSCRIBER_EVENT = "voice_note.captured";
export const SUBSCRIBER_SCOPES = ["voice_notes.read", "voice_notes.subscribe"] as const;
/** EPIC-21 V1: an app that forwards its own voice notes into Zenod (the ingest door, nothing else). */
export const FORWARD_SCOPE = "voice_notes.write";
export type GrantScope = (typeof SUBSCRIBER_SCOPES)[number] | typeof FORWARD_SCOPE;
export const SUBSCRIBER_TOKEN_PREFIX = "zvn_";
export const DELIVERY_LOG_DAYS = 7;
export const DELIVERY_TIMEOUT_MS = 5_000;
export const DELIVERY_RETRY_MS = [2_000, 10_000] as const;

export function subscribersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ZENOD_SUBSCRIBERS?.trim().toLowerCase() === "on";
}

export const hashSubscriberToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const opaque = (prefix: string, bytes = 32): string => `${prefix}${randomBytes(bytes).toString("base64url")}`;
const shortId = (prefix: string): string => `${prefix}${randomBytes(9).toString("base64url")}`;

export type SubscriptionVia = "oauth" | "manual";
export type SubscriptionKind = "agent_team" | "webhook";

export interface SubscriberPerson {
  name: string | null;
  email: string | null;
}

export interface SubscriberGrant {
  id: string;
  clientId: string;
  clientName: string;
  scope: string;
  account: SubscriberPerson;
  createdAt: string;
}

export interface DeliveryRecord {
  id: string;
  subscriptionId: string;
  eventId: string;
  type: string;
  test: boolean;
  noteId: string | null;
  at: string;
  ok: boolean;
  status: "delivering" | "retrying" | "delivered" | "failed";
  httpStatus: number | null;
  durationMs: number | null;
  attempts: number;
  error: string | null;
}

export interface Subscription {
  id: string;
  name: string;
  kind: SubscriptionKind;
  product: string | null;
  url: string;
  event: string;
  enabled: boolean;
  via: SubscriptionVia;
  grantId: string | null;
  createdAt: string;
  createdBy: SubscriberPerson;
}

export interface SubscriptionView extends Subscription {
  lastDelivery: DeliveryRecord | null;
  retries24h: number;
}

interface SubscriptionRow {
  id: string;
  name: string;
  kind: string;
  product: string | null;
  url: string;
  event: string;
  enabled: number;
  via: string;
  grant_id: string | null;
  created_at: string;
  created_by_name: string | null;
  created_by_email: string | null;
  secret_handle: string;
}

interface DeliveryRow {
  id: string;
  subscription_id: string;
  event_id: string;
  type: string;
  test: number;
  note_id: string | null;
  at: string;
  ok: number;
  status: string;
  http_status: number | null;
  duration_ms: number | null;
  attempts: number;
  error: string | null;
}

const secretKey = (subscriptionId: string): string => `subscriber_secret_${subscriptionId}`;

export class SubscriberStore {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(
    path: string,
    private readonly vault: CredentialVault,
    private readonly now: () => number = Date.now,
  ) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriber_grants (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL,
        client_name TEXT NOT NULL,
        scope TEXT NOT NULL,
        account_name TEXT,
        account_email TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        product TEXT,
        url TEXT NOT NULL,
        event TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        via TEXT NOT NULL,
        grant_id TEXT,
        created_at TEXT NOT NULL,
        created_by_name TEXT,
        created_by_email TEXT,
        secret_handle TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_subscriptions_grant ON subscriptions (grant_id);
      CREATE TABLE IF NOT EXISTS subscriber_deliveries (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        type TEXT NOT NULL,
        test INTEGER NOT NULL DEFAULT 0,
        note_id TEXT,
        at TEXT NOT NULL,
        ok INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        http_status INTEGER,
        duration_ms INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_deliveries_subscription ON subscriber_deliveries (subscription_id, at);
      CREATE INDEX IF NOT EXISTS idx_deliveries_note ON subscriber_deliveries (note_id);
    `);
  }

  // --- grants (Sign in with Zenod) ---

  /** Create a grant and its bearer token; only the token's hash is kept. The token is returned once. */
  createGrant(input: { clientId: string; clientName: string; scope: string; account: SubscriberPerson }): { grant: SubscriberGrant; token: string; tokenHash: string } {
    const token = opaque(SUBSCRIBER_TOKEN_PREFIX);
    const tokenHash = hashSubscriberToken(token);
    const grant: SubscriberGrant = {
      id: shortId("grt_"),
      clientId: input.clientId,
      clientName: input.clientName.slice(0, 200),
      scope: input.scope,
      account: input.account,
      createdAt: new Date(this.now()).toISOString(),
    };
    this.db
      .prepare(`INSERT INTO subscriber_grants (id, token_hash, client_id, client_name, scope, account_name, account_email, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(grant.id, tokenHash, grant.clientId, grant.clientName, grant.scope, grant.account.name, grant.account.email, grant.createdAt);
    return { grant, token, tokenHash };
  }

  grantForTokenHash(tokenHash: string): SubscriberGrant | null {
    const row = this.db.prepare("SELECT * FROM subscriber_grants WHERE token_hash = ?").get(tokenHash) as Record<string, string | null> | undefined;
    return row ? toGrant(row) : null;
  }

  /** Every grant, newest first (EPIC-21 V1: forwarding apps have a grant and no subscription). */
  grants(): SubscriberGrant[] {
    return (this.db.prepare("SELECT * FROM subscriber_grants ORDER BY created_at DESC").all() as Array<Record<string, string | null>>).map(toGrant);
  }

  grant(id: string): SubscriberGrant | null {
    const row = this.db.prepare("SELECT * FROM subscriber_grants WHERE id = ?").get(id) as Record<string, string | null> | undefined;
    return row ? toGrant(row) : null;
  }

  /** Revoke a grant: the grant row, every subscription made with it, their secrets and logs. */
  revokeGrant(grantId: string): boolean {
    for (const sub of this.list().filter((s) => s.grantId === grantId)) this.delete(sub.id, { keepGrant: true });
    return Number(this.db.prepare("DELETE FROM subscriber_grants WHERE id = ?").run(grantId).changes) > 0;
  }

  // --- subscriptions ---

  create(input: {
    name: string;
    kind: SubscriptionKind;
    product?: string | null;
    url: string;
    event: string;
    via: SubscriptionVia;
    grantId?: string | null;
    createdBy?: SubscriberPerson;
  }): { subscription: Subscription; signingSecret: string } {
    const id = shortId("sub_");
    const signingSecret = opaque("whsec_", 24);
    const handle = this.vault.put(secretKey(id), signingSecret);
    const subscription: Subscription = {
      id,
      name: input.name.slice(0, 80),
      kind: input.kind,
      product: input.product?.slice(0, 80) || null,
      url: input.url,
      event: input.event,
      enabled: true,
      via: input.via,
      grantId: input.grantId ?? null,
      createdAt: new Date(this.now()).toISOString(),
      createdBy: input.createdBy ?? { name: null, email: null },
    };
    try {
      this.db
        .prepare(`INSERT INTO subscriptions (id, name, kind, product, url, event, enabled, via, grant_id, created_at, created_by_name, created_by_email, secret_handle)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`)
        .run(id, subscription.name, subscription.kind, subscription.product, subscription.url, subscription.event, subscription.via,
          subscription.grantId, subscription.createdAt, subscription.createdBy.name, subscription.createdBy.email, handle);
    } catch (error) {
      this.vault.delete(secretKey(id), handle);
      throw error;
    }
    return { subscription, signingSecret };
  }

  list(): Subscription[] {
    return (this.db.prepare("SELECT * FROM subscriptions ORDER BY created_at ASC").all() as unknown as SubscriptionRow[]).map(toSubscription);
  }

  get(id: string): Subscription | null {
    const row = this.db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as unknown as SubscriptionRow | undefined;
    return row ? toSubscription(row) : null;
  }

  forGrant(grantId: string): Subscription[] {
    return this.list().filter((sub) => sub.grantId === grantId);
  }

  setEnabled(id: string, enabled: boolean): Subscription | null {
    this.db.prepare("UPDATE subscriptions SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
    return this.get(id);
  }

  /** Delete a subscription with its secret and log. An oauth subscription also revokes its grant unless told not to. */
  delete(id: string, options: { keepGrant?: boolean } = {}): boolean {
    const row = this.db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as unknown as SubscriptionRow | undefined;
    if (!row) return false;
    this.vault.delete(secretKey(id), row.secret_handle);
    this.db.prepare("DELETE FROM subscriber_deliveries WHERE subscription_id = ?").run(id);
    this.db.prepare("DELETE FROM subscriptions WHERE id = ?").run(id);
    if (!options.keepGrant && row.grant_id) this.db.prepare("DELETE FROM subscriber_grants WHERE id = ?").run(row.grant_id);
    return true;
  }

  signingSecret(id: string): string | null {
    const row = this.db.prepare("SELECT secret_handle FROM subscriptions WHERE id = ?").get(id) as { secret_handle: string } | undefined;
    return row ? this.vault.materialize(secretKey(id), row.secret_handle) : null;
  }

  view(sub: Subscription): SubscriptionView {
    const since = new Date(this.now() - 24 * 3600_000).toISOString();
    const last = this.db
      .prepare("SELECT * FROM subscriber_deliveries WHERE subscription_id = ? ORDER BY at DESC LIMIT 1")
      .get(sub.id) as unknown as DeliveryRow | undefined;
    const retries = this.db
      .prepare("SELECT COALESCE(SUM(CASE WHEN attempts > 1 THEN attempts - 1 ELSE 0 END), 0) AS n FROM subscriber_deliveries WHERE subscription_id = ? AND at >= ?")
      .get(sub.id, since) as { n: number };
    return { ...sub, lastDelivery: last ? toDelivery(last) : null, retries24h: Number(retries.n) };
  }

  // --- delivery log ---

  startDelivery(input: { subscriptionId: string; eventId: string; type: string; test: boolean; noteId: string | null }): DeliveryRecord {
    const record: DeliveryRecord = {
      id: shortId("dlv_"),
      ...input,
      at: new Date(this.now()).toISOString(),
      ok: false,
      status: "delivering",
      httpStatus: null,
      durationMs: null,
      attempts: 0,
      error: null,
    };
    this.db
      .prepare(`INSERT INTO subscriber_deliveries (id, subscription_id, event_id, type, test, note_id, at, ok, status, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'delivering', 0)`)
      .run(record.id, record.subscriptionId, record.eventId, record.type, record.test ? 1 : 0, record.noteId, record.at);
    return record;
  }

  updateDelivery(record: DeliveryRecord): void {
    this.db
      .prepare("UPDATE subscriber_deliveries SET ok = ?, status = ?, http_status = ?, duration_ms = ?, attempts = ?, error = ? WHERE id = ?")
      .run(record.ok ? 1 : 0, record.status, record.httpStatus, record.durationMs, record.attempts, record.error, record.id);
  }

  deliveries(subscriptionId: string, limit = 50): DeliveryRecord[] {
    const since = new Date(this.now() - DELIVERY_LOG_DAYS * 86_400_000).toISOString();
    return (this.db
      .prepare("SELECT * FROM subscriber_deliveries WHERE subscription_id = ? AND at >= ? ORDER BY at DESC LIMIT ?")
      .all(subscriptionId, since, Math.max(1, Math.min(limit, 200))) as unknown as DeliveryRow[]).map(toDelivery);
  }

  /** True when Zenod announced this note to one of the grant's subscriptions. */
  announcedToGrant(grantId: string, noteId: string): boolean {
    return Boolean(this.db
      .prepare(`SELECT 1 FROM subscriber_deliveries d JOIN subscriptions s ON s.id = d.subscription_id
        WHERE s.grant_id = ? AND d.note_id = ? AND d.test = 0 LIMIT 1`)
      .get(grantId, noteId));
  }

  pruneDeliveries(): number {
    const before = new Date(this.now() - DELIVERY_LOG_DAYS * 86_400_000).toISOString();
    return Number(this.db.prepare("DELETE FROM subscriber_deliveries WHERE at < ?").run(before).changes);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

function toGrant(row: Record<string, string | null>): SubscriberGrant {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    clientName: String(row.client_name),
    scope: String(row.scope),
    account: { name: row.account_name ?? null, email: row.account_email ?? null },
    createdAt: String(row.created_at),
  };
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "agent_team" ? "agent_team" : "webhook",
    product: row.product,
    url: row.url,
    event: row.event,
    enabled: row.enabled === 1,
    via: row.via === "oauth" ? "oauth" : "manual",
    grantId: row.grant_id,
    createdAt: row.created_at,
    createdBy: { name: row.created_by_name, email: row.created_by_email },
  };
}

function toDelivery(row: DeliveryRow): DeliveryRecord {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    eventId: row.event_id,
    type: row.type,
    test: row.test === 1,
    noteId: row.note_id,
    at: row.at,
    ok: row.ok === 1,
    status: (["delivering", "retrying", "delivered", "failed"].includes(row.status) ? row.status : "failed") as DeliveryRecord["status"],
    httpStatus: row.http_status,
    durationMs: row.duration_ms,
    attempts: row.attempts,
    error: row.error,
  };
}

// --- JSON shapes (contract sections 2 and 3) ---

export function deliveryJson(d: DeliveryRecord): Record<string, unknown> {
  return {
    id: d.id,
    event_id: d.eventId,
    type: d.type,
    test: d.test,
    at: d.at,
    ok: d.ok,
    status: d.status,
    http_status: d.httpStatus,
    duration_ms: d.durationMs,
    attempts: d.attempts,
    error: d.error,
  };
}

export function subscriptionJson(view: SubscriptionView): Record<string, unknown> {
  return {
    id: view.id,
    name: view.name,
    kind: view.kind,
    product: view.product,
    url: view.url,
    event: view.event,
    enabled: view.enabled,
    created_at: view.createdAt,
    created_by: view.createdBy,
    via: view.via,
    last_delivery: view.lastDelivery
      ? {
          at: view.lastDelivery.at,
          ok: view.lastDelivery.ok,
          http_status: view.lastDelivery.httpStatus,
          duration_ms: view.lastDelivery.durationMs,
          attempts: view.lastDelivery.attempts,
          test: view.lastDelivery.test,
          error: view.lastDelivery.error,
        }
      : null,
    retries_24h: view.retries24h,
  };
}

// --- URL policy (contract sections 2 and 7) ---

export type AddressLookup = (hostname: string) => Promise<string[]>;

const defaultLookup: AddressLookup = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((row) => row.address);

export class SubscriberUrlError extends Error {
  readonly code = "url_not_allowed";
}

export interface SubscriberUrlPolicy {
  /** Exact origins (scheme://host:port) the operator allows on a private address, for the listed tenants only. */
  privateOrigins: ReadonlySet<string>;
  privateTenants: ReadonlySet<string>;
}

const csv = (raw: string | undefined): Set<string> => new Set((raw ?? "").split(",").map((v) => v.trim()).filter(Boolean));

export function subscriberUrlPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): SubscriberUrlPolicy {
  const privateOrigins = new Set<string>();
  for (const raw of csv(env.ZENOD_SUBSCRIBERS_PRIVATE_ORIGINS)) {
    try {
      const url = new URL(raw);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== "null") privateOrigins.add(url.origin);
    } catch {
      // ignore a malformed entry: the exception stays closed for it
    }
  }
  return { privateOrigins, privateTenants: csv(env.ZENOD_SUBSCRIBERS_PRIVATE_TENANTS) };
}

/** Accept a public HTTPS URL, or an operator-listed private origin for an operator-listed tenant. Throws SubscriberUrlError. */
export async function validateSubscriberUrl(
  raw: unknown,
  options: { tenantId: string; policy: SubscriberUrlPolicy; lookup?: AddressLookup },
): Promise<URL> {
  if (typeof raw !== "string" || raw.length > 2048) throw new SubscriberUrlError("URL must be an HTTPS address.");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SubscriberUrlError("URL must be an HTTPS address.");
  }
  if (url.username || url.password) throw new SubscriberUrlError("URL must not contain credentials.");
  if (url.hash) throw new SubscriberUrlError("URL must not contain a fragment.");
  if (options.policy.privateOrigins.has(url.origin) && options.policy.privateTenants.has(options.tenantId)) return url;
  if (url.protocol !== "https:") throw new SubscriberUrlError("URL must use HTTPS.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new SubscriberUrlError("URL must be a public address.");
  let addresses: string[];
  try {
    addresses = isIP(hostname) ? [hostname] : await (options.lookup ?? defaultLookup)(hostname);
  } catch {
    throw new SubscriberUrlError("URL hostname did not resolve.");
  }
  if (!addresses.length) throw new SubscriberUrlError("URL hostname did not resolve.");
  if (addresses.some(isPrivateAddress)) throw new SubscriberUrlError("URL resolves to a private, loopback or link-local address.");
  return url;
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized === "::1") return true;
  if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

// --- signing and delivery (contract sections 3-5) ---

export function signSubscriberEvent(body: string, secret: string, unixSeconds: number): string {
  return `t=${unixSeconds},v1=${createHmac("sha256", secret).update(`${unixSeconds}.${body}`).digest("hex")}`;
}

export interface StoredEntry {
  evidenceRef: string;
  contentType?: string;
  source?: string;
  capturedAt?: string;
  /** EPIC-21 V1: the OAuth client that forwarded this note; its own subscriptions are not told about it. */
  forwardedBy?: string;
}

export type EntryStoredListener = (entry: StoredEntry) => void;

export interface DispatcherOptions {
  tenantId: string;
  store: SubscriberStore;
  policy: SubscriberUrlPolicy;
  /** Public base URL used in `note.url` (contract section 3). */
  publicBaseUrl: string;
  fetch?: typeof fetch;
  lookup?: AddressLookup;
  now?: () => number;
  retryMs?: readonly number[];
  timeoutMs?: number;
  log?: (line: string) => void;
}

export const TEST_NOTE_ID = "test";

export class SubscriberDispatcher {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly cancelled = new Set<string>();

  constructor(private readonly options: DispatcherOptions) {}

  /** The URL policy this tenant's deliveries use (the same one checks a new subscriber's URL). */
  get policy(): SubscriberUrlPolicy {
    return this.options.policy;
  }

  /** Called after a capture is durably stored; never throws, never awaited by the caller. */
  readonly onEntryStored: EntryStoredListener = (entry) => {
    if (!entry.evidenceRef || entry.contentType !== "voice_note") return;
    let subs: Subscription[];
    try {
      subs = this.options.store.list().filter((sub) => sub.enabled && sub.event === SUBSCRIBER_EVENT &&
        // A note an app forwarded is not announced back to that same app (no echo loop).
        !(entry.forwardedBy && sub.grantId && this.options.store.grant(sub.grantId)?.clientId === entry.forwardedBy));
    } catch {
      return;
    }
    if (!subs.length) return;
    const capturedAt = entry.capturedAt ?? new Date(this.now()).toISOString();
    for (const sub of subs) {
      this.track(this.deliver(sub, {
        eventId: shortId("evt_"),
        test: false,
        note: { id: entry.evidenceRef, capturedAt, source: entry.source ?? null },
      }, { retries: true }).catch(() => undefined));
    }
  };

  /** One try, no retries, awaited (contract: POST …/test). */
  sendTest(sub: Subscription): Promise<DeliveryRecord> {
    return this.deliver(sub, {
      eventId: shortId("evt_"),
      test: true,
      note: { id: TEST_NOTE_ID, capturedAt: new Date(this.now()).toISOString(), source: "test" },
    }, { retries: false });
  }

  /** Stop pending retries for a removed subscription. */
  cancel(subscriptionId: string): void {
    this.cancelled.add(subscriptionId);
  }

  /** Wait for in-flight deliveries (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private track(promise: Promise<unknown>): void {
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise));
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  eventBody(sub: Subscription, event: { eventId: string; test: boolean; note: { id: string; capturedAt: string; source: string | null } }): string {
    const noteUrl = new URL("/api/subscribers/v1/notes", this.options.publicBaseUrl);
    noteUrl.searchParams.set("id", event.note.id);
    return JSON.stringify({
      id: event.eventId,
      type: SUBSCRIBER_EVENT,
      created_at: new Date(this.now()).toISOString(),
      test: event.test,
      subscription_id: sub.id,
      note: {
        id: event.note.id,
        captured_at: event.note.capturedAt,
        source: event.note.source,
        content_type: "voice_note",
        url: noteUrl.toString(),
      },
    });
  }

  private async deliver(
    sub: Subscription,
    event: { eventId: string; test: boolean; note: { id: string; capturedAt: string; source: string | null } },
    mode: { retries: boolean },
  ): Promise<DeliveryRecord> {
    const { store } = this.options;
    const record = store.startDelivery({
      subscriptionId: sub.id,
      eventId: event.eventId,
      type: SUBSCRIBER_EVENT,
      test: event.test,
      noteId: event.test ? null : event.note.id,
    });
    const retryMs = mode.retries ? (this.options.retryMs ?? DELIVERY_RETRY_MS) : [];
    const body = this.eventBody(sub, event);
    const doFetch = this.options.fetch ?? fetch;
    const log = this.options.log ?? ((line: string) => console.log(line));
    for (let attempt = 1; ; attempt += 1) {
      const secret = store.signingSecret(sub.id);
      if (!secret || this.cancelled.has(sub.id)) {
        record.status = "failed";
        record.error = "subscription removed";
        safeUpdate(store, record);
        return record;
      }
      const started = this.now();
      let retryable = false;
      record.attempts = attempt;
      try {
        // Re-check the address on every try, so a DNS change cannot point a delivery at a private host.
        await validateSubscriberUrl(sub.url, { tenantId: this.options.tenantId, policy: this.options.policy, lookup: this.options.lookup });
        const response = await doFetch(sub.url, {
          method: "POST",
          redirect: "manual",
          headers: {
            "content-type": "application/json",
            "user-agent": "Zenod-Subscribers/1",
            "x-zenod-event-id": event.eventId,
            "x-zenod-event-type": SUBSCRIBER_EVENT,
            "x-zenod-delivery-attempt": String(attempt),
            // Signed per try so a late retry still lands inside the receiver's 5-minute window.
            "x-zenod-signature": signSubscriberEvent(body, secret, Math.floor(this.now() / 1000)),
          },
          body,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? DELIVERY_TIMEOUT_MS),
        });
        await response.body?.cancel().catch(() => undefined);
        record.httpStatus = response.status;
        record.ok = response.status >= 200 && response.status < 300;
        record.error = record.ok ? null : `HTTP ${response.status}`;
        retryable = !record.ok && (response.status >= 500 || response.status === 429 || (response.status >= 300 && response.status < 400));
      } catch (error) {
        record.ok = false;
        record.httpStatus = null;
        record.error = error instanceof SubscriberUrlError
          ? error.message
          : error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "network error";
        retryable = !(error instanceof SubscriberUrlError);
      }
      record.durationMs = Math.max(0, this.now() - started);
      const more = retryable && attempt <= retryMs.length;
      record.status = record.ok ? "delivered" : more ? "retrying" : "failed";
      safeUpdate(store, record);
      if (!more) {
        log(`[subscribers] tenant=${this.options.tenantId} ${sub.id} ${event.test ? "test" : "voice note"} -> ${record.ok ? record.httpStatus : `failed (${record.error})`} after ${attempt} ${attempt === 1 ? "try" : "tries"}`);
        return record;
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs[attempt - 1]));
    }
  }
}

function safeUpdate(store: SubscriberStore, record: DeliveryRecord): void {
  try {
    store.updateDelivery(record);
  } catch {
    // a removed subscription or a closing store: the delivery outcome is only logged
  }
}
