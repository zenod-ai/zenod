/**
 * Epaminon's execution queue — the heart of the executor's side of the
 * Epaminon↔Archus protocol (docs/EPAMINON-ARCHUS-PROTOCOL.md).
 *
 * It is the STATE AUTHORITY + concurrency controller for execution tickets Archus
 * dispatches to Epaminon. It is deliberately pure: all I/O is injected as seams, so
 * the state machine + concurrency are fully unit-testable without a runner, Archus,
 * or the network.
 *
 * Writer split (from the protocol): Archus writes `queued` (mint) and `approved`
 * (human content-approval); Epaminon writes the rest. This module models EPAMINON'S
 * view — a ticket enters at `queued` via enqueue(), and Epaminon drives it through
 * running → needs-review/done/blocked/failed, REPORTING each of his edges to Archus
 * via the injected `report` seam (which maps to apply_execution_event). `approved`
 * arrives as a dispatch (approve()), never an internal transition.
 */

export type ExecState = "queued" | "running" | "needs-review" | "approved" | "done" | "blocked" | "failed";

/** The states Epaminon reports to Archus (his edges). `queued`/`approved` are Archus's. */
export type ReportedState = "running" | "needs-review" | "done" | "blocked" | "failed";

export interface ExecutionTicket {
  /** Stable id minted by Archus; the key for every protocol message. */
  executionId: string;
  /** The work ticket being executed, fully qualified: "owner/repo#N". */
  target: string;
  /** Run context Archus handed over (objective/scope/done-condition + goal). */
  context: string;
  state: ExecState;
  /** PR/commit URL (code) or the artifact/draft ref (non-code), once there is one. */
  evidenceUrl?: string;
  /** One short line — e.g. a blocker summary or unblock guidance. */
  note?: string;
  /** The human's (possibly edited) final content, carried by approve_execution. */
  finalContent?: string;
  /** Whether this run's outcome is outward/irreversible (gates needs-review vs done). */
  outward?: boolean;
  updatedAt: number;
}

/** An apply_execution_event payload — one Epaminon-owned edge. */
export interface ExecutionEvent {
  executionId: string;
  state: ReportedState;
  evidenceUrl?: string;
  note?: string;
}

export interface ExecutionQueueOptions {
  /** Max tickets actively executing (state === "running") at once. */
  concurrency: number;
  /** Start the runner/worker for a ticket. Epaminon-internal; the worker later calls
   *  back via reportOutcome/reportBlocked. Errors here fail the ticket. */
  launch: (ticket: ExecutionTicket) => void | Promise<void>;
  /** Ship an APPROVED outward outcome — route to Outbound (send) or the runner (merge)
   *  — and return the evidence URL. Errors fail the ticket. */
  ship: (ticket: ExecutionTicket) => Promise<string>;
  /** Report an Epaminon-owned state edge up to Archus (apply_execution_event). Must be
   *  idempotent on Archus's side; this module also never reports the same edge twice. */
  report: (event: ExecutionEvent) => void | Promise<void>;
  /** Injected clock (tests + resume-determinism — never call Date.now directly). */
  now?: () => number;
}

/** Legal transitions, keyed by from-state. Anything not listed throws. */
const TRANSITIONS: Record<ExecState, ExecState[]> = {
  queued: ["running"],
  running: ["needs-review", "done", "blocked", "failed"],
  "needs-review": ["approved", "failed"],
  approved: ["done", "failed"],
  blocked: ["queued", "failed"], // unblock re-queues; rescope fails
  done: [],
  failed: [],
};

export class IllegalTransitionError extends Error {
  constructor(id: string, from: ExecState, to: ExecState) {
    super(`execution ${id}: illegal transition ${from} → ${to}`);
  }
}

export class ExecutionQueue {
  private readonly tickets = new Map<string, ExecutionTicket>();
  private readonly opts: Required<Pick<ExecutionQueueOptions, "concurrency" | "launch" | "ship" | "report">> & {
    now: () => number;
  };

  constructor(options: ExecutionQueueOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new Error("concurrency must be a positive integer");
    }
    this.opts = {
      concurrency: options.concurrency,
      launch: options.launch,
      ship: options.ship,
      report: options.report,
      now: options.now ?? (() => 0),
    };
  }

  /** Tickets actively occupying a slot. needs-review/approved are PARKED (no worker). */
  private runningCount(): number {
    let n = 0;
    for (const t of this.tickets.values()) if (t.state === "running") n++;
    return n;
  }

  private async transition(ticket: ExecutionTicket, to: ExecState): Promise<void> {
    if (!TRANSITIONS[ticket.state].includes(to)) {
      throw new IllegalTransitionError(ticket.executionId, ticket.state, to);
    }
    ticket.state = to;
    ticket.updatedAt = this.opts.now();
  }

  /** Start as many queued tickets as the concurrency cap allows (oldest first). */
  private async pump(): Promise<void> {
    while (this.runningCount() < this.opts.concurrency) {
      const next = [...this.tickets.values()]
        .filter((t) => t.state === "queued")
        .sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!next) return;
      await this.transition(next, "running");
      await this.opts.report({ executionId: next.executionId, state: "running" });
      try {
        await this.opts.launch(next);
      } catch (err) {
        await this.fail(next.executionId, `launch failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * `enqueue_execution` (Archus → Epaminon). Add a freshly-minted ticket at `queued`
   * and start it if there's a slot. Idempotent: a duplicate id is ignored (so a
   * re-dispatch after a retry never double-runs).
   */
  async enqueue(input: { executionId: string; target: string; context: string }): Promise<void> {
    if (this.tickets.has(input.executionId)) return;
    this.tickets.set(input.executionId, {
      executionId: input.executionId,
      target: input.target,
      context: input.context,
      state: "queued",
      updatedAt: this.opts.now(),
    });
    await this.pump();
  }

  /**
   * The worker finished. `outward` decides the gate: an outward/irreversible outcome
   * (a PR to merge, a tweet/email to send) parks at `needs-review` for human approval;
   * an internal artifact (a filed note) completes at `done`. Frees the slot either way.
   */
  async reportOutcome(input: { executionId: string; outward: boolean; evidenceUrl?: string; note?: string }): Promise<void> {
    const t = this.require(input.executionId);
    if (t.state !== "running") return; // tolerate duplicate/out-of-order callbacks
    t.outward = input.outward;
    if (input.evidenceUrl !== undefined) t.evidenceUrl = input.evidenceUrl;
    if (input.note !== undefined) t.note = input.note;
    const to: ReportedState = input.outward ? "needs-review" : "done";
    await this.transition(t, to);
    await this.opts.report({ executionId: t.executionId, state: to, evidenceUrl: t.evidenceUrl, note: t.note });
    await this.pump();
  }

  /** The worker hit a blocker Epaminon could not auto-resolve. Parks at `blocked`, frees the slot. */
  async reportBlocked(input: { executionId: string; note: string }): Promise<void> {
    const t = this.require(input.executionId);
    if (t.state !== "running") return;
    t.note = input.note;
    await this.transition(t, "blocked");
    await this.opts.report({ executionId: t.executionId, state: "blocked", note: input.note });
    await this.pump();
  }

  /**
   * `approve_execution` (Archus → Epaminon). The human approved the content at
   * needs-review; ship it (route to Outbound/runner via the `ship` seam) and report
   * `done` with the real evidence URL. Idempotent: approving an already-shipped ticket
   * is a no-op. A ship failure fails the ticket.
   */
  async approve(input: { executionId: string; finalContent?: string }): Promise<void> {
    const t = this.require(input.executionId);
    if (t.state === "done" || t.state === "approved") return; // idempotent
    if (t.state !== "needs-review") throw new IllegalTransitionError(t.executionId, t.state, "approved");
    if (input.finalContent !== undefined) t.finalContent = input.finalContent;
    await this.transition(t, "approved"); // mirrors Archus's exec:approved; not reported (Archus owns it)
    let evidenceUrl: string;
    try {
      evidenceUrl = await this.opts.ship(t);
    } catch (err) {
      await this.fail(t.executionId, `ship failed: ${(err as Error).message}`);
      return;
    }
    t.evidenceUrl = evidenceUrl;
    await this.transition(t, "done");
    await this.opts.report({ executionId: t.executionId, state: "done", evidenceUrl });
  }

  /**
   * Resume a blocked ticket after an advisory unblock from Archus — re-queue it (with
   * the guidance as context) so the pump relaunches it under the concurrency cap.
   */
  async unblock(input: { executionId: string; guidance?: string }): Promise<void> {
    const t = this.require(input.executionId);
    if (t.state !== "blocked") return;
    if (input.guidance) t.context = `${t.context}\n\n[unblock guidance] ${input.guidance}`;
    await this.transition(t, "queued");
    await this.pump();
  }

  /** Terminal failure from any non-terminal state (incl. a rescoped blocked ticket). */
  async fail(executionId: string, note?: string): Promise<void> {
    const t = this.require(executionId);
    if (t.state === "done" || t.state === "failed") return;
    if (note !== undefined) t.note = note;
    await this.transition(t, "failed");
    await this.opts.report({ executionId, state: "failed", note });
    await this.pump();
  }

  /** Read a ticket (for execution_status). Returns a copy. */
  get(executionId: string): ExecutionTicket | undefined {
    const t = this.tickets.get(executionId);
    return t ? { ...t } : undefined;
  }

  /** All tickets (for execution_status), newest activity first. */
  snapshot(): ExecutionTicket[] {
    return [...this.tickets.values()].map((t) => ({ ...t })).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private require(executionId: string): ExecutionTicket {
    const t = this.tickets.get(executionId);
    if (!t) throw new Error(`unknown execution ${executionId}`);
    return t;
  }
}
