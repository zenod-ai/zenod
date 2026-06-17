import { ExecutionQueue, type ExecutionEvent, type ExecutionTicket } from "./executionQueue.js";
import type { ExecutionStore } from "./executionStore.js";
import type { Settings } from "./settings.js";

/**
 * Epaminon's execution lane — the ExecutionQueue wired to the protocol's seams
 * (docs/EPAMINON-ARCHUS-PROTOCOL.md). Mirrors the Archus side
 * (docs/ARCHUS-TWO-TIER-PLAN.md): everything is internal-mesh, lane-secret-gated,
 * and INERT until the Console cross-provisions the lane (#196) — exactly the shape
 * Archus's /api/exec/event receiver already uses.
 *
 * Seams:
 * - `report`  → POST `apply_execution_event` to Archus (deterministic, no-LLM). REAL,
 *   but inert until `exec_lane_secret` + `exec_archus_url` are provisioned.
 * - `launch`  → hand the ticket to the runner (run-on-command). STUB until #194.
 * - `ship`    → route an approved outward outcome to Outbound (send) / runner (merge).
 *   STUB until #197.
 */

const DEFAULT_CONCURRENCY = 3;

export function buildExecutionQueue(settings: Settings, store: ExecutionStore): ExecutionQueue {
  const configured = Number(settings.getRaw("exec_concurrency"));
  const concurrency = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_CONCURRENCY;
  return new ExecutionQueue({
    concurrency,
    initialTickets: store.active(),
    launch: (t) => launchExecution(t),
    ship: (t) => shipExecution(t),
    report: (e) => reportToArchus(settings, e),
    onChange: (t) => store.upsert(t),
    now: () => Date.now(),
  });
}

/**
 * `apply_execution_event` (Epaminon → Archus). POST the state edge to Archus's
 * receiver with the cross-provisioned lane secret. Inert (logs + returns) until the
 * Console provisions `exec_lane_secret` + `exec_archus_url`; never throws on the
 * un-provisioned path so a boot before enable doesn't crash the queue.
 */
async function reportToArchus(settings: Settings, e: ExecutionEvent): Promise<void> {
  const secret = settings.getRaw("exec_lane_secret");
  const base = settings.getRaw("exec_archus_url");
  if (!secret || !base) {
    console.warn(
      `[exec-lane] not provisioned — dropping ${e.executionId}:${e.state} (need exec_lane_secret + exec_archus_url, #196)`,
    );
    return;
  }
  const res = await fetch(`${base.replace(/\/$/, "")}/api/exec/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Lane-Secret": secret },
    body: JSON.stringify({
      execution_id: Number(e.executionId),
      state: e.state,
      ...(e.evidenceUrl ? { evidence_url: e.evidenceUrl } : {}),
      ...(e.note ? { note: e.note } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err: unknown) => {
    throw new Error(`apply_execution_event POST failed: ${(err as Error).message}`);
  });
  if (!res.ok) throw new Error(`Archus rejected apply_execution_event (HTTP ${res.status})`);
}

/** STUB (#194): re-point the runner to run this ticket on command, reporting back. */
async function launchExecution(t: ExecutionTicket): Promise<void> {
  const base = process.env.ZENOD_RUNNER_POKE_URL?.trim();
  if (!base) {
    console.warn(`[exec-lane] no runner (ZENOD_RUNNER_POKE_URL unset) — ${t.executionId} stays running, not launched (#194)`);
    return;
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ execution_id: t.executionId, target: t.target, context: t.context }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.warn(`[exec-lane] runner refused /run for ${t.executionId} (HTTP ${res.status}) — awaiting runner #194`);
  } catch (err) {
    console.warn(`[exec-lane] runner /run unreachable for ${t.executionId}: ${(err as Error).message} — awaiting runner #194`);
  }
}

/** STUB (#197): route an approved outward outcome to Outbound (send) / runner (merge). */
async function shipExecution(t: ExecutionTicket): Promise<string> {
  throw new Error(`ship not wired yet (#197): cannot ship ${t.executionId} (${t.target})`);
}
