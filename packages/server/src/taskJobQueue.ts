import type { BrainEngine } from "zenod";
import type { TaskJob, TaskJobInput, TaskJobKind, TaskJobStore } from "./taskJobStore.js";

/**
 * Background worker that drains the agentic-job queue one job at a time, fully
 * decoupled from any HTTP request. Serial by design: each turn runs a
 * multi-minute LLM loop and the vault is a single serialized writer, so running
 * them concurrently only contends the write queue and hammers the provider —
 * the durable queue lets fan-out callers enqueue freely and poll for results
 * instead of holding a connection open until the (proxy/client) timeout. A
 * restart marks in-flight jobs interrupted (see TaskJobStore).
 */
export class TaskJobQueue {
  private draining = false;

  constructor(
    private readonly store: TaskJobStore,
    private readonly getEngine: () => Promise<BrainEngine>,
  ) {}

  /** Enqueue a job and start draining; returns immediately with the queued job. */
  enqueue(kind: TaskJobKind, input: TaskJobInput): TaskJob {
    const job = this.store.enqueue(kind, input);
    void this.drain();
    return job;
  }

  get(id: string): TaskJob | null {
    return this.store.get(id);
  }

  recent(limit?: number): TaskJob[] {
    return this.store.recent(limit);
  }

  /** Resume after boot: pick up anything still queued. */
  resume(): void {
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let job: TaskJob | null;
      while ((job = this.store.nextQueued())) {
        await this.process(job);
      }
    } finally {
      this.draining = false;
    }
  }

  private async process(job: TaskJob): Promise<void> {
    this.store.update(job.id, { status: "running" });
    try {
      const engine = await this.getEngine();
      if (job.kind === "task") {
        const result = await engine.handleTasking({
          text: job.input.text ?? "",
          surface: "mcp",
          conversationKey: job.input.conversationKey ?? "mcp",
        });
        this.store.update(job.id, { status: "done", result });
      } else {
        const result = await engine.work({
          objective: job.input.objective ?? "",
          ...(job.input.plan ? { plan: job.input.plan } : {}),
        });
        this.store.update(job.id, { status: "done", result });
      }
      console.log(`[task-job] ${job.id} done: ${job.kind}`);
    } catch (err) {
      console.error(`[task-job] ${job.id} failed:`, err);
      this.store.update(job.id, { status: "error", error: (err as Error).message });
    }
  }
}
