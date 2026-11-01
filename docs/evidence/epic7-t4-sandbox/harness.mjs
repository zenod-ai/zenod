// EPIC-7 T4 sandbox proof harness (sk_test_ only). Run next to stripe-testers.mjs on VPS1:
//   node harness.mjs <step> --key-file /etc/alpha9-secrets/phylax/STRIPE_SECRET_KEY [args]
// Steps: clock (test clock + customer, no card), checkout <customer> [promo_id], session <cs_id>,
//        advance <clock> <unix>, to-renewal <sub_id> <days>, sub <sub_id>, invoices <sub_id>, forever-replica <clock>
import { readFileSync } from "node:fs";
import { keyMode, makeStripe, parseArgs } from "./stripe-testers.mjs";

const PRICE = "price_1UWskz76yJ3p1J6XreTpyfdS"; // T2.1 sandbox €9/month
const opts = parseArgs(process.argv.slice(2));
const key = readFileSync(opts["key-file"], "utf8").trim();
if (keyMode(key) !== "test") throw new Error("sandbox only");
const S = makeStripe(key);
const [step, a, b] = opts._;
const out = (o) => console.log(JSON.stringify(o, null, 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (step === "clock") {
  const clock = await S("POST", "test_helpers/test_clocks", { frozen_time: Math.floor(Date.now() / 1000), name: "EPIC-7 T4 tester" });
  const cus = await S("POST", "customers", { email: "t4-sandbox@example.com", name: "T4 sandbox tester", test_clock: clock.id });
  out({ clock: clock.id, frozen_time: clock.frozen_time, customer: cus.id });
} else if (step === "checkout") {
  // Same shape as packages/server/src/customerBilling.ts createCustomerCheckout for Zenod.
  const metadata = { "metadata[product]": "zenod", "metadata[unit]": "zenod", "metadata[tier]": "monthly", "metadata[account_id]": "t4-sandbox" };
  const sub_meta = Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`subscription_data${k.replace("metadata", "[metadata]")}`, v]));
  const params = {
    mode: "subscription", customer: a, "line_items[0][price]": PRICE, "line_items[0][quantity]": 1,
    client_reference_id: "t4-sandbox", ...metadata, ...sub_meta,
    billing_address_collection: "required", "tax_id_collection[enabled]": "true",
    payment_method_collection: "if_required", "customer_update[address]": "auto", "customer_update[name]": "auto",
    success_url: "https://example.com/ok?session_id={CHECKOUT_SESSION_ID}", cancel_url: "https://example.com/cancel",
  };
  if (b) params["discounts[0][promotion_code]"] = b; else params.allow_promotion_codes = "true";
  try { const cs = await S("POST", "checkout/sessions", params); out({ session: cs.id, url: cs.url, amount_total: cs.amount_total, payment_method_collection: cs.payment_method_collection }); }
  catch (e) { out({ error: e.message }); }
} else if (step === "session") {
  const cs = await S("GET", `checkout/sessions/${a}`, { "expand[]": ["total_details.breakdown"] });
  out({ status: cs.status, payment_status: cs.payment_status, amount_total: cs.amount_total, subscription: cs.subscription, discounts: cs.total_details?.breakdown?.discounts?.map((d) => ({ coupon: d.discount.coupon.id, promotion_code: d.discount.promotion_code, amount: d.amount })) });
} else if (step === "advance") {
  await S("POST", `test_helpers/test_clocks/${a}/advance`, { frozen_time: b });
  for (let i = 0; i < 120; i += 1) { const c = await S("GET", `test_helpers/test_clocks/${a}`); if (c.status === "ready") { out({ clock: a, frozen_time: c.frozen_time, at: new Date(c.frozen_time * 1000).toISOString() }); process.exit(0); } await sleep(2000); }
  throw new Error("clock stuck");
} else if (step === "to-renewal") {
  // advance the clock to the subscription's current_period_end + <offset days> (negative = before)
  const sub = await S("GET", `subscriptions/${a}`, { "expand[]": ["customer"] });
  const to = sub.current_period_end + Math.round(Number(b) * 86400);
  await S("POST", `test_helpers/test_clocks/${sub.customer.test_clock}/advance`, { frozen_time: to });
  for (let i = 0; i < 120; i += 1) { const c = await S("GET", `test_helpers/test_clocks/${sub.customer.test_clock}`); if (c.status === "ready") { out({ clock: c.id, renewal: new Date(sub.current_period_end * 1000).toISOString(), now: new Date(c.frozen_time * 1000).toISOString() }); process.exit(0); } await sleep(2000); }
  throw new Error("clock stuck");
} else if (step === "sub") {
  const s = await S("GET", `subscriptions/${a}`, { "expand[]": ["discounts", "customer"] });
  const pms = await S("GET", "payment_methods", { customer: s.customer.id });
  out({ id: s.id, status: s.status, current_period_end: new Date(s.current_period_end * 1000).toISOString(), discounts: s.discounts.map((d) => d.coupon.id), metadata: s.metadata, payment_methods: pms.data.length, default_payment_method: s.default_payment_method });
} else if (step === "invoices") {
  const inv = await S("GET", "invoices", { subscription: a, limit: 20 });
  out(inv.data.reverse().map((i) => ({ id: i.id, created: new Date(i.created * 1000).toISOString(), total: i.total, status: i.status, reason: i.billing_reason })));
} else if (step === "forever-replica") {
  // Replica of the live free-forever code (T2.2): 100% forever coupon + unlimited code, redeemed by one subscription.
  let cp; try { cp = await S("GET", "coupons/T4_FREE_FOREVER_REPLICA"); } catch { cp = await S("POST", "coupons", { id: "T4_FREE_FOREVER_REPLICA", percent_off: 100, duration: "forever", name: "T4 free-forever replica" }); }
  const promo = await S("POST", "promotion_codes", { coupon: cp.id, code: `T4FOREVER${Date.now() % 100000}` });
  const cus = await S("POST", "customers", { email: "t4-forever@example.com", test_clock: a });
  const s = await S("POST", "subscriptions", { customer: cus.id, "items[0][price]": PRICE, "discounts[0][promotion_code]": promo.id, collection_method: "charge_automatically" });
  out({ promotion_code: promo.id, code: promo.code, subscription: s.id, status: s.status });
} else throw new Error(`unknown step ${step}`);
