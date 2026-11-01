import { chromium } from "/tmp/pw-s2/node_modules/playwright-core/index.mjs";
const [url, code, prefix] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1100 }, locale: "en-US" });
await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(6000);
if (await p.$("#promotionCode") || await p.getByText("Add promotion code").count()) {
  if (!(await p.isVisible("#promotionCode").catch(() => false))) await p.getByText("Add promotion code").click({ force: true });
  await p.fill("#promotionCode", code);
  await p.getByRole("button", { name: "Apply" }).click();
  await p.waitForTimeout(5000);
} else console.log("promotion code already applied on this session");
await p.screenshot({ path: `${prefix}-applied.png`, fullPage: true });
const els = await p.$$eval("input,select", (xs) => xs.filter((x) => x.offsetParent).map((x) => `${x.tagName} id=${x.id} name=${x.name} type=${x.type} required=${x.required}`));
console.log(els.join("\n"));
const body = await p.innerText("body");
console.log("---BODY---\n" + body.replace(/Afghanistan[\s\S]*Zimbabwe/, "<countries>").slice(0, 1500));
if (process.argv[5] === "submit") {
  if (await p.getByText("Enter address manually").count()) await p.getByText("Enter address manually").click().catch(() => {});
  if (await p.$("#billingCountry")) await p.selectOption("#billingCountry", "ES").catch(() => {});
  await p.waitForTimeout(1000);
  for (const [sel, val] of [["#billingName", "T4 Sandbox Tester"], ["#billingAddressLine1", "Calle Mayor 1"], ["#billingPostalCode", "28013"], ["#billingLocality", "Madrid"]]) {
    if (await p.$(sel)) await p.fill(sel, val).catch(() => {});
  }
  if (await p.$("#billingCountry")) await p.selectOption("#billingCountry", "ES").catch(() => {});
  if (await p.$("#billingAdministrativeArea")) await p.selectOption("#billingAdministrativeArea", { label: "Madrid" }).catch((e) => console.log("province", e.message.slice(0, 80)));
  await p.waitForTimeout(1000);
  await p.screenshot({ path: `${prefix}-before-submit.png`, fullPage: true });
  await p.click('button[type=submit]');
  await p.waitForURL(/example\.com/, { timeout: 60000 }).catch(async (e) => { await p.screenshot({ path: `${prefix}-stuck.png`, fullPage: true }); console.log("STUCK", e.message.slice(0, 200)); });
  console.log("FINAL URL", p.url().replace(/session_id=.*/, "session_id=<cs>"));
}
await b.close();
