import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export interface ObservedDraft {
  id: string;
  text: string;
  status: "pending" | "sent" | "expired";
  created_at: string;
  expires_at: string;
  sent_at?: string;
}

export interface ObservedReceipt {
  id: string;
  draft_id: string;
  text: string;
  url: string;
  created_at: string;
}

interface TenantObservations {
  drafts: ObservedDraft[];
  receipts: ObservedReceipt[];
  usage: { calls: number; sends: number; rejected_drafts: number; throttled: number };
}

type Store = Record<string, TenantObservations>;

export interface HeldActionApproval {
  actionId?: string;
  text: string;
}

export interface HeldActionStore {
  hold(tenantId: string, text: string): ObservedDraft;
  resolve(tenantId: string, approval: HeldActionApproval): ObservedDraft | null;
  replayReceipt(tenantId: string, approval: HeldActionApproval): ObservedReceipt | null;
  receiptForAction(tenantId: string, actionId: string): ObservedReceipt | null;
  recordReceipt(tenantId: string, actionId: string, receiptText: string, url: string): ObservedReceipt;
}

export interface CallisthenesObservationLedgerOptions {
  pendingTtlMs?: number;
  now?: () => Date;
}

function empty(): TenantObservations {
  return { drafts: [], receipts: [], usage: { calls: 0, sends: 0, rejected_drafts: 0, throttled: 0 } };
}

export function observedContentId(tenantId: string, text: string): string {
  return createHash("sha256").update(`${tenantId}\0${text}`).digest("hex").slice(0, 24);
}

export class CallisthenesObservationLedger implements HeldActionStore {
  readonly path: string;
  private readonly pendingTtlMs: number;
  private readonly now: () => Date;

  constructor(dataDir: string, options: CallisthenesObservationLedgerOptions = {}) {
    this.path = join(dataDir, "callisthenes-observations.json");
    this.pendingTtlMs = options.pendingTtlMs ?? 24 * 60 * 60 * 1_000;
    this.now = options.now ?? (() => new Date());
  }

  private load(): Store {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Store;
    } catch {
      return {};
    }
  }

  private save(store: Store): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(store, null, 2), "utf8");
  }

  private mutate(tenantId: string, update: (state: TenantObservations) => void): TenantObservations {
    const store = this.load();
    const state = store[tenantId] ?? empty();
    update(state);
    store[tenantId] = state;
    this.save(store);
    return state;
  }

  private expirePending(state: TenantObservations): void {
    const now = this.now().getTime();
    for (const draft of state.drafts) {
      // Legacy rows did not carry an expiry. Derive it from created_at so the
      // migration cannot turn an old pending action into a permanent approval.
      if (!draft.expires_at) {
        draft.expires_at = new Date(new Date(draft.created_at).getTime() + this.pendingTtlMs).toISOString();
      }
      if (draft.status === "pending" && new Date(draft.expires_at).getTime() <= now) draft.status = "expired";
    }
  }

  observeCall(tenantId: string, resultText: string): void {
    this.mutate(tenantId, (state) => {
      state.usage.calls += 1;
      if (resultText.includes("[throttle_exceeded]")) state.usage.throttled += 1;
    });
  }

  hold(tenantId: string, text: string): ObservedDraft {
    let draft!: ObservedDraft;
    this.mutate(tenantId, (state) => {
      this.expirePending(state);
      const existing = state.drafts.find((item) => item.status === "pending" && item.text === text);
      if (existing) {
        draft = existing;
        return;
      }
      const createdAt = this.now();
      draft = {
        id: `act_${randomUUID().replaceAll("-", "")}`,
        text,
        status: "pending",
        created_at: createdAt.toISOString(),
        expires_at: new Date(createdAt.getTime() + this.pendingTtlMs).toISOString(),
      };
      state.drafts.unshift(draft);
      state.usage.rejected_drafts += 1;
    });
    return draft;
  }

  observeRejectedDraft(tenantId: string, text: string): ObservedDraft {
    return this.hold(tenantId, text);
  }

  resolve(tenantId: string, approval: HeldActionApproval): ObservedDraft | null {
    let resolved: ObservedDraft | null = null;
    this.mutate(tenantId, (state) => {
      this.expirePending(state);
      if (approval.actionId) {
        resolved = state.drafts.find((item) =>
          item.id === approval.actionId && item.status === "pending" && item.text === approval.text
        ) ?? null;
        return;
      }
      const matches = state.drafts.filter((item) => item.status === "pending" && item.text === approval.text);
      resolved = matches.length === 1 ? matches[0]! : null;
    });
    return resolved;
  }

  receiptForAction(tenantId: string, actionId: string): ObservedReceipt | null {
    return this.load()[tenantId]?.receipts.find((item) => item.draft_id === actionId) ?? null;
  }

  replayReceipt(tenantId: string, approval: HeldActionApproval): ObservedReceipt | null {
    const state = this.load()[tenantId];
    if (!state) return null;
    if (approval.actionId) {
      const sent = state.drafts.find((item) =>
        item.id === approval.actionId && item.status === "sent" && item.text === approval.text
      );
      if (sent) return state.receipts.find((item) => item.draft_id === sent.id) ?? null;
      // Pre-action-id ledgers keyed receipts by tenant+text and could contain
      // no draft row. Keep that receipt replayable without accepting an
      // arbitrary action id or weakening the exact-text binding.
      if (
        approval.actionId === observedContentId(tenantId, approval.text) &&
        !state.drafts.some((draft) => draft.id === approval.actionId)
      ) {
        return state.receipts.find((item) => item.draft_id === approval.actionId) ?? null;
      }
      return null;
    }
    // Text-only compatibility is safe only when the historical receipt is
    // unique. A newly pending same-text action is resolved before this method,
    // so an old receipt can never shadow a deliberate new publication.
    const receipts = state.drafts
      .filter((item) => item.status === "sent" && item.text === approval.text)
      .map((item) => state.receipts.find((receipt) => receipt.draft_id === item.id))
      .filter((receipt): receipt is ObservedReceipt => Boolean(receipt));
    const legacyId = observedContentId(tenantId, approval.text);
    const legacy = state.receipts.find((receipt) =>
      receipt.draft_id === legacyId && !state.drafts.some((draft) => draft.id === legacyId)
    );
    if (legacy) receipts.push(legacy);
    return receipts.length === 1 ? receipts[0]! : null;
  }

  recordReceipt(tenantId: string, actionId: string, receiptText: string, url: string): ObservedReceipt {
    let receipt!: ObservedReceipt;
    this.mutate(tenantId, (state) => {
      const existing = state.receipts.find((item) => item.draft_id === actionId);
      if (existing) {
        receipt = existing;
        return;
      }
      const now = this.now().toISOString();
      receipt = { id: observedContentId(tenantId, url), draft_id: actionId, text: receiptText, url, created_at: now };
      state.receipts.unshift(receipt);
      const draft = state.drafts.find((item) => item.id === actionId);
      if (draft) {
        draft.status = "sent";
        draft.sent_at = now;
      }
      state.usage.sends += 1;
    });
    return receipt;
  }

  observeReceipt(tenantId: string, text: string, receiptText: string, url: string): ObservedReceipt {
    const action = this.resolve(tenantId, { text });
    if (!action) throw new Error("cannot record a receipt without one exact pending action");
    return this.recordReceipt(tenantId, action.id, receiptText, url);
  }

  read(tenantId: string): TenantObservations {
    return this.load()[tenantId] ?? empty();
  }
}
