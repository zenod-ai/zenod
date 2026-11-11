// E14-S37 local check, the browser half: the Clarifier in Helpers, a Run now, and its question card in
// the inbox. Made-up data only.
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/dev-login`);
const helper = page.locator("li", { has: page.getByText("Clarifier", { exact: true }) });
await helper.first().waitFor({ timeout: 20000 });
await page.waitForTimeout(400);
await helper.first().screenshot({ path: `${OUT}/01-helper.png` });
console.log("run:", JSON.stringify(await (await page.request.post(`${BASE}/dev/run/clarifier`)).json()));
await page.goto(`${BASE}/#inbox`);
const item = page.locator('[data-testid="inbox-item"]', { hasText: "Ana" });
await item.first().waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
await item.first().screenshot({ path: `${OUT}/02-card.png` });
await page.screenshot({ path: `${OUT}/03-inbox.png`, fullPage: true });
console.log("errors:", errors.length ? errors : "none");
await browser.close();
