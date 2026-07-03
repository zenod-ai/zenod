/**
 * S-1 · Worker output is readable — live and after death.
 *
 * The worker already streams `events.jsonl` (one JSON event per line) as it runs.
 * This module is the SERVER-side reduction of that stream into two human reads:
 *   1. `renderRecentEvents` — the last N events as plain-English labels, for mid-run
 *      `execution_status` ("what is it doing right now?").
 *   2. `transcriptObjectKey` — the durable key each run's full stream is stored under,
 *      so the whole transcript resolves after the run is dead (survives deploys).
 *
 * Everything here is PURE: it reads the STRUCTURE of the stream (which tool ran, which
 * turn), never a worker's prose as a progress claim. That is the same discipline the
 * runner-side heartbeat (`parseHeartbeatObservation`) follows — a worker cannot fake
 * progress by writing "50% done".
 */

/** A human label for a single streamed event, or "" when the line carries no signal. */
function eventLabel(ev: Record<string, unknown>): string {
  const type = String(ev.type ?? "");
  // codex dialect: item.started / item.completed carry the tool/command in `item`.
  if (type === "item.started" || type === "item.completed") {
    const item = (ev.item ?? {}) as Record<string, unknown>;
    const kind = String(item.type ?? item.item_type ?? "");
    if (kind.includes("command") || kind.includes("tool") || kind.includes("function")) {
      return String(item.name ?? item.command ?? item.tool ?? kind ?? "").slice(0, 80);
    }
    if (kind.includes("message") || kind.includes("reasoning")) {
      const t = String(item.text ?? item.content ?? "").replace(/\s+/g, " ").trim();
      return t ? `said: ${t.slice(0, 80)}` : kind.slice(0, 80);
    }
    return kind.slice(0, 80);
  }
  // claude stream-json dialect: an `assistant` event with a tool_use / text block.
  if (type === "assistant") {
    const message = (ev.message ?? {}) as Record<string, unknown>;
    const content = Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : [];
    const tool = content.find((c) => c && c.type === "tool_use");
    if (tool) return String(tool.name ?? "tool").slice(0, 80);
    const text = content.find((c) => c && c.type === "text" && c.text);
    if (text) return `said: ${String(text.text).replace(/\s+/g, " ").trim().slice(0, 80)}`;
    return "assistant";
  }
  if (type === "tool_use" || type === "tool_call") {
    return String(ev.name ?? ev.tool ?? "tool").slice(0, 80);
  }
  if (type === "turn.started" || type === "turn.completed") return type;
  if (type === "engine.fallback") {
    return `engine fallback ${String(ev.from ?? "?")}→${String(ev.to ?? "?")}`;
  }
  return type ? type.slice(0, 80) : "";
}

/**
 * Reduce a raw events.jsonl stream to the last `n` human-rendered event labels, oldest
 * first. Blank/unparseable lines are skipped, not fatal. A stream with no signal lines
 * returns []. Deterministic and pure — safe to call on every status read.
 */
export function renderRecentEvents(raw: string | null | undefined, n = 8): string[] {
  if (!raw) return [];
  const labels: string[] = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const label = eventLabel(ev);
    if (label) labels.push(label);
  }
  return labels.slice(-Math.max(0, n));
}

/** The durable storage key for a run's full transcript. Sanitised to a safe filename. */
export function transcriptObjectKey(executionId: string): string {
  const safe = String(executionId).replace(/[^A-Za-z0-9._-]/g, "_");
  return `${safe}.jsonl`;
}

/** The path (relative to the server origin) a stored transcript resolves at. */
export function transcriptPath(executionId: string): string {
  return `/api/exec/transcript/${encodeURIComponent(String(executionId))}`;
}
