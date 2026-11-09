import type { MemoryEntry, MemoryTreeOutline, MemoryTreeOutlineNode } from "zenod";

/**
 * EPIC-22 E22-2, Memory › At a glance: totals, memories kept each week, the strongest places in the
 * tree and where memories come from. Drawn only from what Zenod already stores (the Log's memory
 * entries and the tree outline); no model call, nothing written.
 */

export const GLANCE_WEEKS = 12;
const GLANCE_PLACES = 6;
const GLANCE_CACHE_MS = 60_000;

export interface MemoryGlance {
  totals: { memories: number; voiceNotes: number; pages: number; places: number; thisWeek: number };
  /** Oldest first; `week` is the Monday it starts (UTC). */
  weeks: Array<{ week: string; kept: number }>;
  /** Top branches of the tree by pages, with their newest capture. */
  places: Array<{ title: string; path: string | null; pages: number; latest: string | null }>;
  /** Where memories come from, most first. */
  sources: Array<{ source: string; label: string; count: number }>;
}

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  web: "Zenod app",
  mcp: "AI apps",
  drive: "Google Drive",
  cli: "Command line",
  selftest: "Tests",
};

function mondayOf(time: number): string {
  const day = new Date(time);
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - offset)).toISOString().slice(0, 10);
}

function roots(outline: MemoryTreeOutline | null): MemoryTreeOutlineNode[] {
  return (outline?.groups ?? []).flatMap((group) => group.children.filter((node) => node.kind === "root"));
}

export function memoryGlance(entries: readonly MemoryEntry[], outline: MemoryTreeOutline | null, now = Date.now()): MemoryGlance {
  const firstWeek = Date.parse(mondayOf(now)) - (GLANCE_WEEKS - 1) * 7 * 86_400_000;
  const weeks = Array.from({ length: GLANCE_WEEKS }, (_, i) => ({ week: new Date(firstWeek + i * 7 * 86_400_000).toISOString().slice(0, 10), kept: 0 }));
  const bySource = new Map<string, number>();
  let voiceNotes = 0;
  for (const entry of entries) {
    if (entry.source === "selftest") continue;
    bySource.set(entry.source, (bySource.get(entry.source) ?? 0) + 1);
    if (entry.contentType === "voice_note" || entry.contentType === "audio") voiceNotes += 1;
    const at = Date.parse(entry.capturedAt);
    if (Number.isNaN(at) || at < firstWeek) continue;
    const slot = weeks[Math.floor((at - firstWeek) / (7 * 86_400_000))];
    if (slot) slot.kept += 1;
  }
  const memories = [...bySource.values()].reduce((sum, count) => sum + count, 0);
  const branches = roots(outline);
  return {
    totals: {
      memories,
      voiceNotes,
      pages: (outline?.placed ?? 0) + (outline?.unplaced ?? 0),
      places: branches.length,
      thisWeek: weeks[weeks.length - 1]!.kept,
    },
    weeks,
    places: [...branches]
      .sort((a, b) => b.pages - a.pages || a.title.localeCompare(b.title))
      .slice(0, GLANCE_PLACES)
      .map((node) => ({ title: node.title, path: node.path, pages: node.pages, latest: node.latest?.date ?? null })),
    sources: [...bySource.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, label: SOURCE_LABEL[source] ?? source, count })),
  };
}

/** One glance per tenant a minute: the Log is read whole, so the tab does not reread it on every visit. */
export class MemoryGlanceCache {
  private readonly entries = new Map<string, { at: number; value: Promise<MemoryGlance> }>();
  constructor(private readonly now: () => number = Date.now) {}

  get(tenantId: string, load: () => Promise<MemoryGlance>): Promise<MemoryGlance> {
    const cached = this.entries.get(tenantId);
    if (cached && this.now() - cached.at < GLANCE_CACHE_MS) return cached.value;
    const value = load();
    this.entries.set(tenantId, { at: this.now(), value });
    value.catch(() => {
      if (this.entries.get(tenantId)?.value === value) this.entries.delete(tenantId);
    });
    return value;
  }
}
