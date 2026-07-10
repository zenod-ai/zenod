import type { TenantContext } from "./index.js";

export type DirectiveSource = "council" | "user" | "system" | string;

export interface OperatingDirectiveInput {
  id?: string;
  text: string;
  source?: DirectiveSource;
  active?: boolean;
}

export interface OperatingDirective {
  id: string;
  text: string;
  source: DirectiveSource;
  active: boolean;
  version: number;
  updatedAt: string;
}

export interface ConductReceiptInput {
  id?: string;
  kind: string;
  status: "ok" | "error" | "accepted" | string;
  summary: string;
  evidence?: unknown[];
  at?: string;
}

export interface ConductReceipt {
  id: string;
  kind: string;
  status: string;
  summary: string;
  evidence: unknown[];
  at: string;
}

export interface SeamConformanceStatus {
  status: "conformant";
  receiptDiscipline: "enabled";
  turnPreamble: "active-directives-re-read";
  tenantIsolation: "tenant-scoped";
  dispatchDepth: "depth<=1";
}

export interface TurnPreamble {
  tenantId: string;
  directives: OperatingDirective[];
  text: string;
}

export interface OperatingRulesSnapshot {
  tenant: TenantContext;
  seam: SeamConformanceStatus;
  directives: OperatingDirective[];
  conductReceipts: ConductReceipt[];
  turnPreamble: TurnPreamble;
}

export interface OperatingRulesStore {
  upsertDirective(
    tenant: TenantContext,
    input: OperatingDirectiveInput,
  ): Promise<OperatingDirective> | OperatingDirective;
  listDirectives(
    tenant: TenantContext,
  ): Promise<OperatingDirective[]> | OperatingDirective[];
  listActiveDirectives(
    tenant: TenantContext,
  ): Promise<OperatingDirective[]> | OperatingDirective[];
  turnPreamble(tenant: TenantContext): Promise<TurnPreamble> | TurnPreamble;
  appendConductReceipt(
    tenant: TenantContext,
    input: ConductReceiptInput,
  ): Promise<ConductReceipt> | ConductReceipt;
  listConductReceipts(
    tenant: TenantContext,
  ): Promise<ConductReceipt[]> | ConductReceipt[];
  snapshot(
    tenant: TenantContext,
  ): Promise<OperatingRulesSnapshot> | OperatingRulesSnapshot;
}

export function defaultSeamConformanceStatus(): SeamConformanceStatus {
  return {
    status: "conformant",
    receiptDiscipline: "enabled",
    turnPreamble: "active-directives-re-read",
    tenantIsolation: "tenant-scoped",
    dispatchDepth: "depth<=1",
  };
}

export function formatTurnPreamble(
  tenant: TenantContext,
  directives: OperatingDirective[],
): TurnPreamble {
  const active = directives.filter((directive) => directive.active);
  const lines = active.map((directive, index) => {
    return `${index + 1}. [${directive.source}] ${directive.text}`;
  });
  return {
    tenantId: tenant.id,
    directives: active,
    text:
      lines.length > 0
        ? `Active operating directives for ${tenant.id}:\n${lines.join("\n")}`
        : `No active operating directives for ${tenant.id}.`,
  };
}

export class MemoryOperatingRulesStore implements OperatingRulesStore {
  private readonly directives = new Map<string, Map<string, OperatingDirective>>();
  private readonly receipts = new Map<string, ConductReceipt[]>();

  upsertDirective(
    tenant: TenantContext,
    input: OperatingDirectiveInput,
  ): OperatingDirective {
    const text = input.text.trim();
    if (!text) throw new Error("directive text is required");
    const tenantDirectives = this.directivesFor(tenant.id);
    const id = input.id?.trim() || stableDirectiveId(text);
    const existing = tenantDirectives.get(id);
    const directive: OperatingDirective = {
      id,
      text,
      source: input.source?.trim() || "user",
      active: input.active ?? true,
      version: (existing?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    tenantDirectives.set(id, directive);
    return cloneDirective(directive);
  }

  listDirectives(tenant: TenantContext): OperatingDirective[] {
    return [...this.directivesFor(tenant.id).values()].map(cloneDirective);
  }

  listActiveDirectives(tenant: TenantContext): OperatingDirective[] {
    return this.listDirectives(tenant).filter((directive) => directive.active);
  }

  turnPreamble(tenant: TenantContext): TurnPreamble {
    return formatTurnPreamble(tenant, this.listActiveDirectives(tenant));
  }

  appendConductReceipt(
    tenant: TenantContext,
    input: ConductReceiptInput,
  ): ConductReceipt {
    const kind = input.kind.trim();
    const summary = input.summary.trim();
    if (!kind) throw new Error("conduct receipt kind is required");
    if (!summary) throw new Error("conduct receipt summary is required");
    const tenantReceipts = this.receiptsFor(tenant.id);
    const receipt: ConductReceipt = {
      id: input.id?.trim() || `receipt_${tenantReceipts.length + 1}`,
      kind,
      status: input.status.trim() || "ok",
      summary,
      evidence: [...(input.evidence ?? [])],
      at: input.at?.trim() || new Date().toISOString(),
    };
    tenantReceipts.unshift(receipt);
    return cloneReceipt(receipt);
  }

  listConductReceipts(tenant: TenantContext): ConductReceipt[] {
    return this.receiptsFor(tenant.id).map(cloneReceipt);
  }

  snapshot(tenant: TenantContext): OperatingRulesSnapshot {
    return {
      tenant: { ...tenant },
      seam: defaultSeamConformanceStatus(),
      directives: this.listDirectives(tenant),
      conductReceipts: this.listConductReceipts(tenant),
      turnPreamble: this.turnPreamble(tenant),
    };
  }

  private directivesFor(tenantId: string): Map<string, OperatingDirective> {
    let tenantDirectives = this.directives.get(tenantId);
    if (!tenantDirectives) {
      tenantDirectives = new Map();
      this.directives.set(tenantId, tenantDirectives);
    }
    return tenantDirectives;
  }

  private receiptsFor(tenantId: string): ConductReceipt[] {
    let tenantReceipts = this.receipts.get(tenantId);
    if (!tenantReceipts) {
      tenantReceipts = [];
      this.receipts.set(tenantId, tenantReceipts);
    }
    return tenantReceipts;
  }
}

function stableDirectiveId(text: string): string {
  return `directive_${Buffer.from(text, "utf8")
    .toString("base64url")
    .slice(0, 24)}`;
}

function cloneDirective(directive: OperatingDirective): OperatingDirective {
  return { ...directive };
}

function cloneReceipt(receipt: ConductReceipt): ConductReceipt {
  return { ...receipt, evidence: [...receipt.evidence] };
}
