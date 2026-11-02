import type { MemoryTreeOutline, TreeSteerResult } from "zenod";
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

  /** Drop a tenant's cached tree (after a pin or rename), so the next read shows it. */
  invalidate(tenantId: string): void {
    this.entries.delete(tenantId);
  }
}

/**
 * Memory tab pin / rename (EPIC-9 E9-5b). The body names the root by its stable id or page
 * path from the tenant's own outline; the runtime writes a Keeper note through the vault
 * write lock. Errors map to a status and a fixed message: never vault content.
 */
export interface ConsoleMemorySteerRequest {
  action: "pin" | "rename";
  root: string;
  name?: string;
}

export type ConsoleMemorySteerResponse =
  | { status: 200; body: { ok: true; changed: boolean; note: string | null; root: TreeSteerResult["root"] } }
  | { status: 400 | 404 | 409 | 503; body: { error: string; code: string } };

export function parseConsoleMemorySteer(body: unknown): ConsoleMemorySteerRequest | null {
  if (!body || typeof body !== "object") return null;
  const { action, root, name } = body as Record<string, unknown>;
  if ((action !== "pin" && action !== "rename") || typeof root !== "string" || !root.trim() || root.length > 300) return null;
  if (action === "rename" && typeof name !== "string") return null;
  return { action, root: root.trim(), ...(action === "rename" ? { name: name as string } : {}) };
}

export async function steerConsoleMemoryTree(
  runtime: Pick<Runtime, "steerMemoryTree">,
  request: ConsoleMemorySteerRequest,
): Promise<ConsoleMemorySteerResponse> {
  try {
    const result = await runtime.steerMemoryTree(request);
    return { status: 200, body: { ok: true, changed: result.changed, note: result.note, root: result.root } };
  } catch (error) {
    const err = error as { name?: string; code?: string } | null;
    if (err?.name === "NotConfiguredError") return { status: 409, body: { error: "no vault connected", code: "not_configured" } };
    if (err?.name === "TreeSteerError") {
      const code = err.code ?? "invalid";
      const status = code === "unknown_root" || code === "no_tree" ? 404 : code === "name_taken" ? 409 : 400;
      const messages: Record<string, string> = {
        unknown_root: "That branch is no longer in your memory tree; reload and try again.",
        no_tree: "Your memory tree is not ready yet.",
        name_taken: "Another branch already has that name.",
        invalid_name: "Use 1–60 characters, without | ^ [ ] or #.",
      };
      return { status, body: { error: messages[code] ?? "That change is not possible.", code } };
    }
    throw error;
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
