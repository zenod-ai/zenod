import type { AddJourneyArtifactInput, JourneyContext, JourneySnapshot, JourneyStep, JourneyStore } from "./journeyStore.js";

export interface JourneyMonitorOptions {
  intervalMs?: number;
  leaseMs?: number;
  now?: () => number;
  reconcileStep?: JourneyStepReconciler;
}

export type JourneyReconcileAction =
  | {
      status: "unchanged";
      reason?: string;
    }
  | {
      status: "running";
      result?: JourneyContext;
      deadlineAt?: number | null;
      artifacts?: AddJourneyArtifactInput[];
    }
  | {
      status: "completed";
      result?: JourneyContext;
      artifacts?: AddJourneyArtifactInput[];
    }
  | {
      status: "blocked" | "failed";
      reason: string;
      artifacts?: AddJourneyArtifactInput[];
    };

export type JourneyStepReconciler = (input: { step: JourneyStep; snapshot: JourneySnapshot }) => JourneyReconcileAction;

export interface JourneyMonitorResult {
  blocked: JourneyStep[];
  claimed: JourneyStep[];
  reconciled: Array<{
    step: JourneyStep;
    action: JourneyReconcileAction;
  }>;
}

export class JourneyMonitor {
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly leaseMs: number;
  private readonly now: () => number;
  private readonly reconcileStep: JourneyStepReconciler | null;

  constructor(
    private readonly store: JourneyStore,
    options: JourneyMonitorOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 30_000;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.reconcileStep = options.reconcileStep ?? null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.runOnce();
      } catch (err) {
        console.error("[journey-monitor] failed:", err);
      }
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  runOnce(limit = 50): JourneyMonitorResult {
    const now = this.now();
    const blocked = this.store.blockOverdueSteps(now, limit);
    if (!this.reconcileStep) return { blocked, claimed: [], reconciled: [] };

    const claimed = this.store.claimDueSteps(now, this.leaseMs, limit);
    const reconciled: JourneyMonitorResult["reconciled"] = [];
    for (const step of claimed) {
      const snapshot = this.store.snapshot(step.journeyId);
      if (!snapshot) continue;
      const action = this.reconcileStep({ step, snapshot });
      reconciled.push({ step, action });
      this.applyAction(step, action, now);
    }
    return { blocked, claimed, reconciled };
  }

  private applyAction(step: JourneyStep, action: JourneyReconcileAction, now: number): void {
    if (action.status === "unchanged") return;
    for (const artifact of action.artifacts ?? []) {
      this.store.addArtifact(step.journeyId, { ...artifact, stepId: artifact.stepId ?? step.id }, now);
    }
    if (action.status === "running") {
      this.store.runStep(step.id, { deadlineAt: action.deadlineAt ?? null }, now);
      return;
    }
    if (action.status === "completed") {
      this.store.completeStep(step.id, action.result ?? {}, now);
      this.store.completeJourneyIfReady(step.journeyId, now);
      return;
    }
    if (action.status === "blocked") {
      this.store.blockStep(step.id, action.reason, now);
      return;
    }
    this.store.failStep(step.id, action.reason, now);
  }
}
