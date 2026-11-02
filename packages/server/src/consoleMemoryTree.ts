import type { MemoryTreeOutline } from "zenod";
// Type-only: the Phylax bundle must not reach runtime.ts (scripts/assert-phylax-bundle.mjs).
import type { NotConfiguredError, Runtime } from "./runtime.js";

/**
 * Console "Memory" tab (EPIC-9 E9-2e): the signed-in customer's memory tree,
 * read live from their own vault. Vault reads are remote (GitHub/Drive), so a
 * built outline is reused per tenant for a short while; failures are never
 * cached. The outline carries titles, paths, dates and Tree.md summaries only.
 */

export const MEMORY_TREE_CACHE_MS = 60_000;

export type ConsoleMemoryTree =
  | { status: "ready"; tree: MemoryTreeOutline }
  /** No Tree.md yet, or no vault connected: the console shows its empty state. */
  | { status: "empty"; tree: null };

export class ConsoleMemoryTreeCache {
  private readonly entries = new Map<string, { at: number; value: Promise<ConsoleMemoryTree> }>();

  constructor(
    private readonly ttlMs = MEMORY_TREE_CACHE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Keyed by tenant id: one tenant's tree is never served to another. */
  get(tenantId: string, runtime: Pick<Runtime, "memoryTreeOutline">): Promise<ConsoleMemoryTree> {
    const cached = this.entries.get(tenantId);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.value;
    const value = loadConsoleMemoryTree(runtime);
    this.entries.set(tenantId, { at: this.now(), value });
    value.catch(() => {
      if (this.entries.get(tenantId)?.value === value) this.entries.delete(tenantId);
    });
    return value;
  }
}

export async function loadConsoleMemoryTree(runtime: Pick<Runtime, "memoryTreeOutline">): Promise<ConsoleMemoryTree> {
  try {
    const tree = await runtime.memoryTreeOutline();
    return tree ? { status: "ready", tree } : { status: "empty", tree: null };
  } catch (error) {
    if ((error as NotConfiguredError | null)?.name === "NotConfiguredError") return { status: "empty", tree: null };
    throw error;
  }
}
