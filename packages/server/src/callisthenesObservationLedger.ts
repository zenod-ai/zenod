import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

export interface ObservedDraft {
  id: string;
  text: string;
  status: "pending" | "sent";
  created_at: string;
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

function empty(): TenantObservations {
  return { drafts: [], receipts: [], usage: { calls: 0, sends: 0, rejected_drafts: 0, throttled: 0 } };
}

export function observedContentId(tenantId: string, text: string): string {
  return createHash("sha256").update(`${tenantId}\0${text}`).digest("hex").slice(0, 24);
}

export class CallisthenesObservationLedger {
  readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "callisthenes-observations.json");
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

  observeCall(tenantId: string, resultText: string): void {
    this.mutate(tenantId, (state) => {
      state.usage.calls += 1;
      if (resultText.includes("[throttle_exceeded]")) state.usage.throttled += 1;
    });
  }

  observeRejectedDraft(tenantId: string, text: string): ObservedDraft {
    const id = observedContentId(tenantId, text);
    let draft!: ObservedDraft;
    this.mutate(tenantId, (state) => {
      const existing = state.drafts.find((item) => item.id === id);
      if (existing) {
        draft = existing;
        return;
      }
      draft = { id, text, status: "pending", created_at: new Date().toISOString() };
      state.drafts.unshift(draft);
      state.usage.rejected_drafts += 1;
    });
    return draft;
  }

  receiptForText(tenantId: string, text: string): ObservedReceipt | null {
    const draftId = observedContentId(tenantId, text);
    return this.load()[tenantId]?.receipts.find((item) => item.draft_id === draftId) ?? null;
  }

  observeReceipt(tenantId: string, text: string, receiptText: string, url: string): ObservedReceipt {
    const draftId = observedContentId(tenantId, text);
    let receipt!: ObservedReceipt;
    this.mutate(tenantId, (state) => {
      const existing = state.receipts.find((item) => item.draft_id === draftId);
      if (existing) {
        receipt = existing;
        return;
      }
      const now = new Date().toISOString();
      receipt = { id: observedContentId(tenantId, url), draft_id: draftId, text: receiptText, url, created_at: now };
      state.receipts.unshift(receipt);
      const draft = state.drafts.find((item) => item.id === draftId);
      if (draft) {
        draft.status = "sent";
        draft.sent_at = now;
      }
      state.usage.sends += 1;
    });
    return receipt;
  }

  read(tenantId: string): TenantObservations {
    return this.load()[tenantId] ?? empty();
  }
}
