#!/usr/bin/env node
// EPIC-7 T4: operator tool for Zenod tester codes (docs/runbooks/epic7-tester-codes.md).
//
// Testers are ordinary Zenod subscribers whose price is €0: they redeem a
// single-use promotion code for the "Zenod tester" coupon (100% off, 1 month)
// at the normal checkout, and the operator extends them month by month with a
// `once` 100% coupon before each renewal (proven in EPIC-7 T2.1).
//
// Commands:
//   setup                  create or reuse the tester coupon and the extension coupon
//   issue <label>          one single-use promotion code, expiring after 14 days;
//                          label -> code is appended to a private ledger (0600), never a repo
//   extend [--days N]      (by hand only; the usual way is one tester at a time on
//                          cloud.zenod.dev/admin/testers, EPIC-26 S5 round 3)
//                          put the extension coupon on every tester subscription renewing
//                          within N days (default 7) whose next invoice is not €0, and recover
//                          a past_due tester (extend + void its open renewal invoice); dry run
//                          unless --apply
//   status                 per tester: code redeemed?, subscription status, next renewal,
//                          next invoice, card on file?
//   retire-code <code>     deactivate a promotion code (by code text or promo_ id);
//                          subscriptions that already redeemed it keep their discount
//
// The key decides the mode: sk_test_/rk_test_ is the sandbox, sk_live_/rk_live_ is live.
// Live writes need --confirm-live <acct_id> matching the key's account. The key is read
// from --key-file or --key-stdin and is never printed.

import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const STRIPE_VERSION = "2025-02-24.acacia";
export const TESTER_COUPON = {
  id: "ZENOD_TESTER_1M",
  name: "Zenod tester",
  percent_off: 100,
  duration: "repeating",
  duration_in_months: 1,
};
export const EXTENSION_COUPON = {
  id: "ZENOD_TESTER_NEXT_MONTH_FREE",
  name: "Zenod tester: next month free",
  percent_off: 100,
  duration: "once",
};
export const CODE_TTL_DAYS = 14;
export const DEFAULT_EXTEND_DAYS = 7;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LEDGER_HEADER = "label\tcode\tpromotion_code\tcreated\texpires";
const TESTER_COUPON_IDS = new Set([TESTER_COUPON.id, EXTENSION_COUPON.id]);
const RENEWING = new Set(["active", "trialing", "past_due"]);
const WRITE_COMMANDS = new Set(["setup", "issue", "retire-code"]);

export function keyMode(key) {
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  throw new Error("not a Stripe secret key (expected sk_test_/sk_live_/rk_test_/rk_live_)");
}

export function makeStripe(key, fetchImpl = globalThis.fetch) {
  return async function call(method, path, params = {}) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      for (const item of Array.isArray(v) ? v : [v]) body.append(k, String(item));
    }
    let url = `https://api.stripe.com/v1/${path}`;
    const init = {
      method,
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_VERSION },
    };
    if (method === "GET") {
      const qs = body.toString();
      if (qs) url += `?${qs}`;
    } else {
      init.body = body;
    }
    const res = await fetchImpl(url, init);
    const json = await res.json();
    if (!res.ok) {
      const err = new Error(`${method} ${path}: ${res.status} ${json?.error?.message ?? "error"}`);
      err.status = res.status;
      err.code = json?.error?.code;
      throw err;
    }
    return json;
  };
}

export function generateCode(bytes = randomBytes(8)) {
  let out = "";
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `ZT-${out}`;
}

async function listAll(stripe, path, params) {
  const out = [];
  let startingAfter;
  for (;;) {
    const page = await stripe("GET", path, { limit: 100, ...params, starting_after: startingAfter });
    out.push(...page.data);
    if (!page.has_more || page.data.length === 0) return out;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

function couponMismatches(found, want) {
  const keys = ["percent_off", "duration", ...(want.duration === "repeating" ? ["duration_in_months"] : [])];
  const bad = keys.filter((k) => found[k] !== want[k]).map((k) => `${k}=${found[k]} (want ${want[k]})`);
  if (found.valid === false) bad.push("valid=false");
  return bad;
}

export async function setup(stripe) {
  const results = [];
  for (const want of [TESTER_COUPON, EXTENSION_COUPON]) {
    let coupon;
    let created = false;
    try {
      coupon = await stripe("GET", `coupons/${want.id}`);
    } catch (err) {
      if (err.status !== 404) throw err;
      coupon = await stripe("POST", "coupons", {
        id: want.id,
        name: want.name,
        percent_off: want.percent_off,
        duration: want.duration,
        duration_in_months: want.duration_in_months,
        "metadata[zenod_tester]": "1",
      });
      created = true;
    }
    const bad = couponMismatches(coupon, want);
    if (bad.length) throw new Error(`coupon ${want.id} exists but differs: ${bad.join(", ")}; fix it by hand`);
    results.push({ coupon: coupon.id, name: coupon.name, duration: coupon.duration, created });
  }
  return results;
}

export function ledgerPath(dir, mode) {
  return join(dir, `${mode}-codes.tsv`);
}

export function defaultLedgerDir(env = process.env) {
  return env.ZENOD_TESTERS_LEDGER_DIR || join(homedir(), ".local", "state", "zenod-testers");
}

export function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line && line !== LEDGER_HEADER)
    .map((line) => {
      const [label, code, promotion_code, created, expires] = line.split("\t");
      return { label, code, promotion_code, created, expires };
    });
}

function appendLedger(path, row) {
  const dir = path.slice(0, path.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(path)) appendFileSync(path, `${LEDGER_HEADER}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  appendFileSync(path, `${[row.label, row.code, row.promotion_code, row.created, row.expires].join("\t")}\n`);
}

export async function issue(stripe, { label, ledger, now = Date.now(), ttlSeconds = CODE_TTL_DAYS * 86400, code, force = false }) {
  if (!label || /[\t\n\r]/.test(label)) throw new Error("issue needs a label without tabs or newlines");
  if (!force && readLedger(ledger).some((row) => row.label === label)) {
    throw new Error(`label "${label}" already has a code in the ledger (use --force for a second one)`);
  }
  await stripe("GET", `coupons/${TESTER_COUPON.id}`).catch((err) => {
    throw err.status === 404 ? new Error(`coupon ${TESTER_COUPON.id} missing: run setup first`) : err;
  });
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const promo = await stripe("POST", "promotion_codes", {
    coupon: TESTER_COUPON.id,
    code: code ?? generateCode(),
    max_redemptions: 1,
    expires_at: expiresAt,
    "metadata[zenod_tester]": "1",
  });
  const row = {
    label,
    code: promo.code,
    promotion_code: promo.id,
    created: new Date(promo.created * 1000).toISOString(),
    expires: new Date(promo.expires_at * 1000).toISOString(),
  };
  appendLedger(ledger, row);
  return row;
}

function discountsOf(sub) {
  const list = Array.isArray(sub.discounts) ? sub.discounts.filter((d) => d && typeof d === "object") : [];
  if (sub.discount && !list.some((d) => d.id === sub.discount.id)) list.push(sub.discount);
  return list;
}

function promoIdOf(value) {
  return typeof value === "string" ? value : value?.id ?? null;
}

export function isTesterSubscription(sub) {
  if (sub.metadata?.zenod_tester === "1") return true;
  return discountsOf(sub).some((d) => TESTER_COUPON_IDS.has(d.coupon?.id));
}

export function testerPromoOf(sub) {
  if (sub.metadata?.zenod_tester_promo) return sub.metadata.zenod_tester_promo;
  const d = discountsOf(sub).find((x) => x.coupon?.id === TESTER_COUPON.id && x.promotion_code);
  return d ? promoIdOf(d.promotion_code) : null;
}

export async function listTesterSubscriptions(stripe, { testClock } = {}) {
  const subs = await listAll(stripe, "subscriptions", {
    status: "all",
    test_clock: testClock,
    "expand[]": ["data.discounts", "data.customer"],
  });
  return subs.filter(isTesterSubscription);
}

function clockNow(stripe) {
  const cache = new Map();
  return async (sub, fallback) => {
    const clock = typeof sub.customer === "object" ? sub.customer?.test_clock : null;
    const id = typeof clock === "string" ? clock : clock?.id;
    if (!id) return fallback;
    if (!cache.has(id)) cache.set(id, (await stripe("GET", `test_helpers/test_clocks/${id}`)).frozen_time);
    return cache.get(id);
  };
}

async function openRenewalInvoice(stripe, sub) {
  const id = promoIdOf(sub.latest_invoice);
  if (!id) return null;
  const inv = await stripe("GET", `invoices/${id}`);
  return inv.status === "open" && inv.billing_reason === "subscription_cycle" ? inv : null;
}

async function upcomingTotal(stripe, subId) {
  const inv = await stripe("GET", "invoices/upcoming", { subscription: subId });
  return { total: inv.total, currency: inv.currency };
}

export async function extend(stripe, { days = DEFAULT_EXTEND_DAYS, apply = false, now = Math.floor(Date.now() / 1000), testClock } = {}) {
  const nowFor = clockNow(stripe);
  const results = [];
  for (const sub of await listTesterSubscriptions(stripe, { testClock })) {
    const row = { subscription: sub.id, status: sub.status, renews: iso(sub.current_period_end) };
    results.push(row);
    if (!RENEWING.has(sub.status) || sub.cancel_at_period_end) {
      row.action = "skip: not renewing";
      continue;
    }
    const subNow = await nowFor(sub, now);
    const pastDue = sub.status === "past_due";
    const untagged = sub.metadata?.zenod_tester !== "1";
    const tag = untagged ? { "metadata[zenod_tester]": "1", "metadata[zenod_tester_promo]": testerPromoOf(sub) ?? undefined } : {};
    // A past_due tester missed an extension: always due, and its open renewal invoice is voided
    // (testers are never charged; Stripe would retry the card and cancel after ~13 days).
    const openInvoice = pastDue ? await openRenewalInvoice(stripe, sub) : null;
    if (!pastDue && sub.current_period_end - subNow > days * 86400) {
      row.action = "skip: not due";
      if (apply && untagged) {
        await stripe("POST", `subscriptions/${sub.id}`, tag);
        row.action += " (tagged)";
      }
      continue;
    }
    const before = await upcomingTotal(stripe, sub.id);
    row.next_invoice_before = before.total;
    const steps = [];
    if (before.total !== 0) steps.push("extend");
    if (openInvoice) steps.push(`void ${openInvoice.id} (${openInvoice.total})`);
    if (steps.length === 0) {
      row.action = "skip: next invoice already €0";
      if (apply && untagged) {
        await stripe("POST", `subscriptions/${sub.id}`, tag);
        row.action += " (tagged)";
      }
      continue;
    }
    if (!apply) {
      row.action = `would ${steps.join(" + ")} (dry run)`;
      continue;
    }
    if (before.total !== 0) {
      // EPIC-26 S5 round 3: an extension is the team's call; this mark makes zenod-mt's month-end job
      // leave the extended month alone (the usual way is the button on cloud.zenod.dev/admin/testers).
      await stripe("POST", `subscriptions/${sub.id}`, {
        "discounts[0][coupon]": EXTENSION_COUPON.id,
        proration_behavior: "none",
        "metadata[zenod_tester_month_end]": "extended_by_us",
        "metadata[zenod_tester_extended_for]": String(sub.current_period_end),
        ...tag,
      });
    } else if (untagged) {
      await stripe("POST", `subscriptions/${sub.id}`, tag);
    }
    if (openInvoice) await stripe("POST", `invoices/${openInvoice.id}/void`);
    const after = await upcomingTotal(stripe, sub.id);
    row.next_invoice_after = after.total;
    if (openInvoice) row.status_after = (await stripe("GET", `subscriptions/${sub.id}`)).status;
    const done = steps.map((x) => x.replace(/^extend$/, "extended").replace(/^void/, "voided")).join(" + ");
    row.action = after.total === 0 ? done : `${done} BUT NEXT INVOICE NOT €0: check by hand`;
  }
  return results;
}

async function hasCard(stripe, sub) {
  const customer = sub.customer;
  if (sub.default_payment_method || customer?.invoice_settings?.default_payment_method || customer?.default_source) return true;
  const id = typeof customer === "string" ? customer : customer?.id;
  if (!id) return false;
  const pms = await stripe("GET", "payment_methods", { customer: id, limit: 1 });
  return pms.data.length > 0;
}

function codeState(promo, now) {
  if (promo.times_redeemed >= (promo.max_redemptions ?? Infinity)) return "used";
  if (promo.expires_at && promo.expires_at <= now) return "expired"; // Stripe also sets active=false
  if (!promo.active) return "retired";
  return "open";
}

export async function status(stripe, { ledger, now = Math.floor(Date.now() / 1000), testClock } = {}) {
  const subs = await listTesterSubscriptions(stripe, { testClock });
  const byPromo = new Map(subs.map((s) => [testerPromoOf(s), s]).filter(([p]) => p));
  const seen = new Set();
  const rows = [];
  const describeSub = async (sub) => {
    seen.add(sub.id);
    const renewing = RENEWING.has(sub.status) && !sub.cancel_at_period_end;
    return {
      subscription: sub.id,
      sub_status: sub.status + (sub.cancel_at_period_end ? " (cancels at period end)" : ""),
      next_renewal: renewing ? iso(sub.current_period_end) : "-",
      next_invoice: renewing ? (await upcomingTotal(stripe, sub.id)).total : "-",
      card_on_file: (await hasCard(stripe, sub)) ? "yes" : "no",
    };
  };
  for (const entry of readLedger(ledger)) {
    const promo = await stripe("GET", `promotion_codes/${entry.promotion_code}`);
    const sub = byPromo.get(promo.id);
    rows.push({
      label: entry.label,
      code: entry.code,
      code_state: codeState(promo, now),
      redeemed: `${promo.times_redeemed}/${promo.max_redemptions ?? "∞"}`,
      expires: iso(promo.expires_at),
      ...(sub ? await describeSub(sub) : { subscription: "-" }),
    });
  }
  for (const sub of subs) {
    if (seen.has(sub.id)) continue;
    rows.push({ label: "(not in ledger)", code: "-", ...(await describeSub(sub)) });
  }
  return rows;
}

export async function retireCode(stripe, codeOrId) {
  let promo;
  if (codeOrId.startsWith("promo_")) {
    promo = await stripe("GET", `promotion_codes/${codeOrId}`);
  } else {
    const found = await stripe("GET", "promotion_codes", { code: codeOrId, limit: 10 });
    const exact = found.data.filter((p) => p.code.toUpperCase() === codeOrId.toUpperCase());
    if (exact.length !== 1) throw new Error(`expected one promotion code "${codeOrId}", found ${exact.length}`);
    promo = exact[0];
  }
  const was = promo.active;
  if (was) promo = await stripe("POST", `promotion_codes/${promo.id}`, { active: "false" });
  return {
    promotion_code: promo.id,
    coupon: promo.coupon?.id,
    times_redeemed: promo.times_redeemed,
    was_active: was,
    active: promo.active,
    note: "subscriptions that already redeemed it keep their discount",
  };
}

function iso(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : "-";
}

export function parseArgs(argv) {
  const opts = { _: [] };
  const flags = new Set(["apply", "json", "key-stdin", "force"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      opts._.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (flags.has(name)) opts[name] = true;
    else if (inline !== undefined) opts[name] = inline;
    else if (i + 1 < argv.length) opts[name] = argv[(i += 1)];
    else throw new Error(`--${name} needs a value`);
  }
  return opts;
}

export async function confirmLive({ stripe, mode, command, opts }) {
  if (mode !== "live") return;
  const writes = WRITE_COMMANDS.has(command) || (command === "extend" && opts.apply);
  if (!writes) return;
  const account = await stripe("GET", "account");
  if (opts["confirm-live"] !== account.id) {
    throw new Error(
      `LIVE Stripe write refused: pass --confirm-live ${account.id} (${account.settings?.dashboard?.display_name ?? "live account"}) once the live change is approved`,
    );
  }
}

function readKey(opts) {
  if (opts["key-file"]) return readFileSync(opts["key-file"], "utf8").trim();
  if (opts["key-stdin"]) return readFileSync(0, "utf8").trim();
  throw new Error("pass --key-file <path> or --key-stdin");
}

function print(rows, json) {
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    console.log(Object.entries(row).map(([k, v]) => `${k}=${v}`).join("  "));
  }
}

export async function main(argv = process.argv.slice(2), { fetchImpl } = {}) {
  const opts = parseArgs(argv);
  const [command, arg] = opts._;
  if (!command || command === "help") {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 24).join("\n"));
    return;
  }
  const key = readKey(opts);
  const mode = keyMode(key);
  const stripe = makeStripe(key, fetchImpl);
  if (mode === "live") console.error("!!!!!!!! LIVE STRIPE (real customers, real money) !!!!!!!!");
  else console.error("stripe-testers: TEST MODE (sandbox)");
  if (opts["test-clock"] && mode === "live") throw new Error("--test-clock is sandbox only");
  if (opts["ttl-seconds"] && mode === "live") throw new Error("--ttl-seconds is sandbox only");
  await confirmLive({ stripe, mode, command, opts });
  const ledger = ledgerPath(opts["ledger-dir"] ?? defaultLedgerDir(), mode);
  const days = opts.days === undefined ? DEFAULT_EXTEND_DAYS : Number(opts.days);
  if (!Number.isFinite(days) || days < 0) throw new Error("--days must be a number of days");
  switch (command) {
    case "setup":
      return print(await setup(stripe), opts.json);
    case "issue": {
      const row = await issue(stripe, {
        label: arg,
        ledger,
        force: opts.force,
        code: opts.code,
        ttlSeconds: opts["ttl-seconds"] ? Number(opts["ttl-seconds"]) : undefined,
      });
      console.error(`ledger: ${ledger} (${(statSync(ledger).mode & 0o777).toString(8)})`);
      return print(row, opts.json);
    }
    case "extend":
      if (!opts.apply) console.error("dry run: nothing is changed; add --apply to extend");
      return print(await extend(stripe, { days, apply: opts.apply, testClock: opts["test-clock"] }), opts.json);
    case "status":
      return print(await status(stripe, { ledger, testClock: opts["test-clock"] }), opts.json);
    case "retire-code":
      if (!arg) throw new Error("retire-code needs a code or promo_ id");
      return print(await retireCode(stripe, arg), opts.json);
    default:
      throw new Error(`unknown command "${command}" (setup|issue|extend|status|retire-code)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`stripe-testers: ${err.message}`);
    process.exit(1);
  });
}
