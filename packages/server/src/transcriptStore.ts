import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderRecentEvents, transcriptObjectKey } from "./executionTranscript.js";

/**
 * S-1 (a) — durable storage for each run's full `events.jsonl`, keyed by execution id.
 *
 * The worker's stream lives only in the runner's ephemeral workdir, so it vanishes on
 * the next deploy — exactly when you most want to read why a run died. This store keeps
 * a copy on the server's persistent `/data` volume (survives redeploys), one file per
 * execution id, so the transcript link a completion notification carries still resolves
 * after the worker is long dead.
 *
 * The store is deliberately dumb: a run uploads its stream (whole, or a growing tail),
 * we overwrite the keyed file, and any reader can fetch it back verbatim or as the last
 * N human-rendered events. No parsing on write — the raw bytes are the source of truth.
 */
export class TranscriptStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private pathFor(executionId: string): string {
    return join(this.dir, transcriptObjectKey(executionId));
  }

  /** Persist (overwrite) the full stream for a run. Later uploads supersede earlier ones. */
  put(executionId: string, content: string): void {
    if (!executionId) throw new Error("executionId is required");
    writeFileSync(this.pathFor(executionId), content ?? "");
  }

  /** True once a transcript has been stored for this run. */
  has(executionId: string): boolean {
    return existsSync(this.pathFor(executionId));
  }

  /** The raw stored stream, or null if none was ever uploaded for this run. */
  get(executionId: string): string | null {
    const path = this.pathFor(executionId);
    if (!existsSync(path)) return null;
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  }

  /** Byte length of the stored stream, or 0 when absent — for a cheap "how big" read. */
  size(executionId: string): number {
    const path = this.pathFor(executionId);
    try {
      return existsSync(path) ? statSync(path).size : 0;
    } catch {
      return 0;
    }
  }

  /** The last `n` events, human-rendered, from the stored stream (empty when absent). */
  recentEvents(executionId: string, n = 8): string[] {
    return renderRecentEvents(this.get(executionId), n);
  }
}
