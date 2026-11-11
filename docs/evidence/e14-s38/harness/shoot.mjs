// E14-S38 local check, the browser half: a wake switches Something to try on once (the account was
// connected to its team before it came), it runs, and its card shows in the inbox. Made-up data only.
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/dev-login`);
console.log("wake:", JSON.stringify(await (await page.request.post(`${BASE}/dev/wake`)).json()));
await page.goto(`${BASE}/#inbox`);
// The sign-in already landed on the inbox: load it again so it shows the new card.
await page.reload();
const item = page.locator('[data-testid="inbox-item"]', { hasText: "Something to try" });
await item.first().waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
await item.first().screenshot({ path: `${OUT}/01-card.png` });
await page.goto(`${BASE}/#helpers`);
const helper = page.locator("li.zr-item", { hasText: "Something to try" });
await helper.first().waitFor({ timeout: 20000 });
await page.waitForTimeout(600);
await helper.first().screenshot({ path: `${OUT}/02-helper.png` });
console.log("errors:", errors.length ? errors : "none");
await browser.close();
