import { createHmac } from "node:crypto";

/**
 * Entry hook (agent_team E42-S20): tell one operator-configured listener that a new memory entry was stored, so it
 * can read the entry instead of polling search_memory every minute. The first listener is the agent_team console on
 * the same host, which relays the owner's WhatsApp voice notes to his Team desk.
 *
 * Operator-only and off by default: the URL, secret and tenants come from the process env, never from tenant settings
 * or a tool call, so no tenant can point Zenod at an address of its choosing. It fires only for the listed tenants and
 * content types, carries only a pointer (`evidenceRef`; the listener reads the entry with its own memory token), and
 * is signed `X-Zenod-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">` so the listener can refuse anything else
 * and anything replayed outside its window. Best effort: a failed call is retried twice and then only logged; the
 * capture it follows is already durable, and the listener keeps a slow poll as its safety net.
 *
 * Env: ZENOD_ENTRY_HOOK_URL (http/https), ZENOD_ENTRY_HOOK_SECRET, ZENOD_ENTRY_HOOK_TENANTS (comma list, required),
 * ZENOD_ENTRY_HOOK_CONTENT_TYPES (comma list, default voice_note).
 */

export interface EntryHookConfig {
  url: string;
  secret: string;
  tenants: ReadonlySet<string>;
  contentTypes: ReadonlySet<string>;
}

export interface StoredEntry {
  evidenceRef: string;
  contentType?: string;
  source?: string;
}

export type EntryHook = (entry: StoredEntry) => void;

const list = (raw: string | undefined): Set<string> =>
  new Set((raw ?? "").split(",").map((v) => v.trim()).filter(Boolean));

/** The hook's config, or null (off) when any required value is missing or the URL is not http(s). */
export function entryHookConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EntryHookConfig | null {
  const url = env.ZENOD_ENTRY_HOOK_URL?.trim();
  const secret = env.ZENOD_ENTRY_HOOK_SECRET?.trim();
  const tenants = list(env.ZENOD_ENTRY_HOOK_TENANTS);
  if (!url || !secret || tenants.size === 0) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  const contentTypes = list(env.ZENOD_ENTRY_HOOK_CONTENT_TYPES);
  return { url, secret, tenants, contentTypes: contentTypes.size ? contentTypes : new Set(["voice_note"]) };
}

export function signEntryHook(body: string, secret: string, unixSeconds: number): string {
  return `t=${unixSeconds},v1=${createHmac("sha256", secret).update(`${unixSeconds}.${body}`).digest("hex")}`;
}

export interface EntryHookOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** Delays before the second and third try (ms). */
  retryMs?: readonly number[];
  log?: (line: string) => void;
}

/** A per-tenant hook: a no-op unless the config is set and lists this tenant. */
export function createEntryHook(config: EntryHookConfig | null, tenantId: string, options: EntryHookOptions = {}): EntryHook {
  if (!config || !config.tenants.has(tenantId)) return () => {};
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const retryMs = options.retryMs ?? [2_000, 10_000];
  const log = options.log ?? ((line: string) => console.log(line));

  const send = async (entry: StoredEntry): Promise<void> => {
    const body = JSON.stringify({ event: `${entry.contentType}.stored`, evidenceRef: entry.evidenceRef, tenant: tenantId });
    for (let attempt = 0; ; attempt += 1) {
      let outcome: string;
      try {
        // Signed per try, so a late retry still lands inside the listener's replay window.
        const response = await doFetch(config.url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-zenod-signature": signEntryHook(body, config.secret, Math.floor(now() / 1000)) },
          body,
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok || (response.status >= 400 && response.status < 500)) {
          log(`[entry-hook] tenant=${tenantId} ${entry.evidenceRef} -> ${response.status}`);
          return;
        }
        outcome = `HTTP ${response.status}`;
      } catch (error) {
        outcome = error instanceof Error ? error.name : "error";
      }
      if (attempt >= retryMs.length) {
        log(`[entry-hook] tenant=${tenantId} ${entry.evidenceRef} failed after ${attempt + 1} tries (${outcome})`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs[attempt]));
    }
  };

  return (entry) => {
    if (!entry.evidenceRef || !entry.contentType || !config.contentTypes.has(entry.contentType)) return;
    void send(entry).catch(() => {});
  };
}
