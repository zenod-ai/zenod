// E14-S4 round 2 local check, the browser half: the persona catalog, one persona switched on with
// its own cadence, Run now, and its question and a tidy-up proposal in the Inbox. Demo data only.
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`${BASE}/dev-login`);
await page.getByText("Health of your memory").waitFor();
await page.waitForTimeout(600);
const switches = await page.getByRole("switch").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
console.log("switches:", switches.join(" | "));
console.log("foot:", (await page.locator(".zi-foot").innerText()).replace(/\s+/g, " "));
await page.screenshot({ path: `${OUT}/01-catalog.png`, fullPage: true });

// Open loops finder: on, every 3 days, Run now.
await page.getByRole("switch", { name: "Open loops finder off" }).click();
await page.getByRole("switch", { name: "Open loops finder on" }).waitFor();
await page.getByLabel("How often Open loops finder runs").selectOption("days");
await page.getByText("Every 3 days, at night").waitFor();
await page.locator("li", { hasText: "Open loops finder" }).getByRole("button", { name: "Run now" }).click();
await page.getByText(/found 2 open loops and asked about one/).waitFor({ timeout: 30000 });
// Topic gardener: on, Run now.
await page.getByRole("switch", { name: "Topic gardener off" }).click();
await page.getByRole("switch", { name: "Topic gardener on" }).waitFor();
await page.locator("li", { hasText: "Topic gardener" }).getByRole("button", { name: "Run now" }).click();
await page.getByText(/proposed one tidy-up/).waitFor({ timeout: 30000 });
await page.waitForTimeout(600);
console.log("foot after:", (await page.locator(".zi-foot").innerText()).replace(/\s+/g, " "));
await page.locator("li", { hasText: "Open loops finder" }).first().screenshot({ path: `${OUT}/02-open-loops-on.png` });
await page.screenshot({ path: `${OUT}/03-catalog-after.png`, fullPage: true });
console.log("vault:", JSON.stringify(await (await page.request.get(`${BASE}/dev/commits`)).json()));
await page.goto(`${BASE}/#inbox`);
await page.getByText(/Is this still open\?/).waitFor();
await page.getByText(/Run it\?/).waitFor();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/04-inbox.png`, fullPage: true });
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await m.newPage();
await mp.goto(`${BASE}/dev-login`);
await mp.getByText("Health of your memory").waitFor();
await mp.waitForTimeout(800);
await mp.screenshot({ path: `${OUT}/05-phone.png`, fullPage: false });
await mp.screenshot({ path: `${OUT}/05-phone-full.png`, fullPage: true });
await browser.close();
