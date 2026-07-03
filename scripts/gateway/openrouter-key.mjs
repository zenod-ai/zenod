#!/usr/bin/env node
// LLM gateway v0 — per-tenant metering + budget enforcement (P0.4, epic #448).
//
// This is "the meter" for the hosted plan. It uses OpenRouter PROVISIONED KEYS:
// one virtual key per tenant with a hard credit limit. OpenRouter tracks spend
// and stops honoring the key when the limit is hit — so enforcement lives OUTSIDE
// the tenant container (a buggy or hacked tenant still can't overspend; the key
// just 402s). The engine needs no change: a tenant runs provider=openrouter with
// its per-tenant key, and the existing OpenRouter base URL already routes here.
//
// Why this over self-hosting LiteLLM for v0: zero ops (OpenRouter runs it, ~5%),
// and we already run on OpenRouter. Swap to a self-hosted LiteLLM proxy when the
// markup margin justifies the ops — at that point set the tenant's LLM base URL
// to the proxy (hook: ZENOD_LLM_BASE_URL, see docs) and reuse the same per-key
// budget model. See docs/HOSTED-PLAN-2026-07-02.md §7.2.
//
// Requires a PROVISIONING key (NOT a normal inference key): create one at
// https://openrouter.ai/settings/provisioning-keys and export it:
//   export OPENROUTER_PROVISIONING_KEY=sk-or-v1-...
//
// Usage:
//   node scripts/gateway/openrouter-key.mjs mint   --tenant acme --limit 50
//   node scripts/gateway/openrouter-key.mjs list
//   node scripts/gateway/openrouter-key.mjs show   --hash <hash>
//   node scripts/gateway/openrouter-key.mjs topup  --hash <hash> --limit 100
//   node scripts/gateway/openrouter-key.mjs disable --hash <hash>
//   node scripts/gateway/openrouter-key.mjs enable  --hash <hash>
//
// `mint` prints the key ONCE (OpenRouter never returns it again) — paste it into
// the tenant Console as its OpenRouter key. `--limit` is the credit cap in USD.

const API = "https://openrouter.ai/api/v1/keys";
export const NAME_PREFIX = "zenod-tenant:";

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/** Parse `--flag value` pairs into an object. Throws on a malformed flag so the
 *  CLI fails loudly rather than silently minting the wrong key. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k?.startsWith("--")) throw new Error(`unexpected argument: ${k}`);
    out[k.slice(2)] = argv[i + 1];
  }
  return out;
}

/** The provisioning-key name we stamp on every tenant key, for round-tripping. */
export function tenantKeyName(tenant) {
  return `${NAME_PREFIX}${tenant}`;
}

/** Keep only keys this tool minted, and project them to a compact row. */
export function tenantKeys(all) {
  return (all ?? [])
    .filter((k) => (k.name ?? "").startsWith(NAME_PREFIX))
    .map((k) => ({
      tenant: (k.name ?? "").slice(NAME_PREFIX.length),
      hash: k.hash,
      limit: k.limit ?? null,
      usage: k.usage ?? 0,
      disabled: Boolean(k.disabled),
    }));
}

async function api(path, method, body) {
  const key = process.env.OPENROUTER_PROVISIONING_KEY;
  if (!key) die("OPENROUTER_PROVISIONING_KEY is not set (a provisioning key, not an inference key)");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    die(`OpenRouter returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) die(`OpenRouter ${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function mint(args) {
  if (!args.tenant) die("mint needs --tenant <name>");
  const limit = args.limit === undefined ? undefined : Number(args.limit);
  if (limit !== undefined && !Number.isFinite(limit)) die("--limit must be a number (USD credit cap)");
  const created = await api("", "POST", {
    name: `${NAME_PREFIX}${args.tenant}`,
    ...(limit !== undefined ? { limit } : {}),
  });
  const key = created.key;
  const hash = created.data?.hash;
  console.log("Minted per-tenant OpenRouter key.");
  console.log(`  tenant: ${args.tenant}`);
  console.log(`  hash:   ${hash}   (use this for topup/disable — it is NOT the key)`);
  console.log(`  limit:  ${limit === undefined ? "unlimited (set one!)" : `$${limit}`}`);
  console.log("");
  console.log("  KEY (shown once — paste into the tenant Console's OpenRouter key):");
  console.log(`  ${key}`);
}

async function list() {
  const res = await api("", "GET");
  const keys = tenantKeys(res.data);
  if (!keys.length) return console.log("No tenant keys found.");
  for (const k of keys) {
    const limit = k.limit == null ? "∞" : `$${k.limit}`;
    console.log(`${k.disabled ? "✗" : "✓"} ${k.tenant.padEnd(16)} spent $${k.usage.toFixed(2)} / ${limit}   hash=${k.hash}`);
  }
}

async function show(args) {
  if (!args.hash) die("show needs --hash <hash>");
  console.log(JSON.stringify(await api(`/${args.hash}`, "GET"), null, 2));
}

async function topup(args) {
  if (!args.hash) die("topup needs --hash <hash>");
  const limit = Number(args.limit);
  if (!Number.isFinite(limit)) die("topup needs --limit <newTotalUSD>");
  await api(`/${args.hash}`, "PATCH", { limit });
  console.log(`Set credit limit to $${limit}.`);
}

async function setDisabled(args, disabled) {
  if (!args.hash) die(`${disabled ? "disable" : "enable"} needs --hash <hash>`);
  await api(`/${args.hash}`, "PATCH", { disabled });
  console.log(`Key ${disabled ? "disabled (suspended)" : "enabled"}.`);
}

// Only run the CLI when invoked directly (not when imported by the test file).
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(rest);
  } catch (err) {
    die(err.message);
  }
  const commands = {
    mint: () => mint(args),
    list: () => list(),
    show: () => show(args),
    topup: () => topup(args),
    disable: () => setDisabled(args, true),
    enable: () => setDisabled(args, false),
  };
  if (!commands[cmd]) {
    console.error("usage: openrouter-key.mjs <mint|list|show|topup|disable|enable> [--tenant n] [--hash h] [--limit usd]");
    process.exit(cmd ? 1 : 0);
  }
  commands[cmd]().catch((err) => die(err?.message ?? String(err)));
}
