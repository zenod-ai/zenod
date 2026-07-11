import type { PeerConfig } from "./peerClient.js";
import { validateWalletUrl } from "./walletUrl.js";

/** UUID pattern — what z2 returns for queued task jobs. */
function extractUuid(text: string): string | null {
  const m = text.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  return m?.[1] ?? null;
}

/**
 * Extract a task-job UUID from a handleTasking reply. Scans both the
 * human-readable reply text AND the raw tool-call results — the LLM doesn't
 * always echo the UUID in its reply text, but the MCP result always has it.
 */
export function extractJobId(reply: { text: string; actions: Array<{ result: string }> }): string | null {
  return (
    extractUuid(reply.text) ??
    reply.actions.map((a) => extractUuid(a.result)).find(Boolean) ??
    null
  );
}

function peerApiUrl(peerUrl: string, jobId: string): string {
  const url = new URL(peerUrl);
  url.pathname = url.pathname.replace(/\/mcp\/?$/, "");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/tasks/jobs/${jobId}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

interface JobPollResult {
  status: "done" | "error" | "timeout";
  error?: string;
  kind?: string;
  result?: unknown;
}

interface TaskJobResponse {
  job: { status: string; error?: string; kind?: string; result?: unknown };
}

/**
 * Poll the first peer that knows about jobId every intervalMs until the job
 * reaches a terminal state or the timeout elapses. Silently absorbs network
 * errors — the worst case is a timeout, which callers treat as silent.
 */
export async function pollPeerJob(
  peers: PeerConfig[],
  jobId: string,
  intervalMs = 5_000,
  timeoutMs = 180_000,
): Promise<JobPollResult> {
  if (!peers.length) return { status: "timeout" };
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, intervalMs));

    for (const peer of peers) {
      const pollUrl = peerApiUrl(peer.url, jobId);
      const hostname = new URL(pollUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
      try {
        await validateWalletUrl(pollUrl, { allowHosts: peer.allowPrivateHost ? [hostname] : [] });
      } catch (error) {
        return {
          status: "error",
          error: `Peer job polling refused: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      try {
        const res = await fetch(pollUrl, {
          headers: { Authorization: `Bearer ${peer.token}` },
        });
        if (!res.ok) continue;
        const { job } = (await res.json()) as TaskJobResponse;
        if (job.status === "done") return { status: "done", kind: job.kind, result: job.result };
        if (job.status === "error" || job.status === "interrupted")
          return { status: "error", error: job.error };
        // "queued" or "running" — keep waiting
        break; // found the right peer, don't try others
      } catch {
        // network error — try next peer
      }
    }
  }

  return { status: "timeout" };
}
