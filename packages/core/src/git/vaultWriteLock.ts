import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { chmod, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

interface Ownership { path: string; active: boolean }
const ownership = new AsyncLocalStorage<Ownership>();

export class VaultWriteBusyError extends Error {
  readonly code = "vault_write_busy";
  constructor() { super("Vault is in use by another operation; retry after it finishes."); this.name = "VaultWriteBusyError"; }
}

/**
 * SQLite's OS-managed lock, on a private sibling file, serializes a canonical
 * local vault across processes. It holds no user data and is never synchronized.
 * Crash closes the connection and releases ownership; elapsed time NEVER steals
 * a live writer's lock. Busy retries are asynchronous so job heartbeats continue.
 */
export async function withVaultWriteLock<T>(vaultPath: string, fn: () => Promise<T>, waitMs = 300_000): Promise<T> {
  const path = await realpath(vaultPath);
  const inherited = ownership.getStore();
  if (inherited?.path === path && inherited.active) return fn();
  const key = createHash("sha256").update(path).digest("hex").slice(0, 24);
  const lockPath = join(dirname(path), `.zenod-vault-lock-${key}.sqlite`);
  const db = new DatabaseSync(lockPath);
  const deadline = performance.now() + Math.max(0, waitMs);
  let acquired = false;
  const token = { path, active: true };
  try {
    await chmod(lockPath, 0o600);
    db.exec("PRAGMA busy_timeout=0");
    for (;;) {
      try { db.exec("BEGIN IMMEDIATE"); acquired = true; break; }
      catch (error) {
        const code = (error as { errcode?: number }).errcode;
        if (code !== 5 && code !== 6) throw error;
        if (performance.now() >= deadline) throw new VaultWriteBusyError();
        await delay(Math.min(50, Math.max(1, deadline - performance.now())));
      }
    }
    return await ownership.run(token, fn);
  } finally {
    token.active = false;
    try { if (acquired) db.exec("ROLLBACK"); } finally { db.close(); }
  }
}
