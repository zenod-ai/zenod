// E14-S35 local check, the browser half: the Helpers tab with asking the team switched on, a Run now
// that asks once, and the card that says what the team said. Made-up data only.
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/dev-login`);
const box = page.getByRole("checkbox", { name: /Ask your team how things connect/ });
await box.first().waitFor({ timeout: 20000 });
// The switch is the server's answer: it shows checked once the change is saved.
if (!(await box.first().isChecked())) await box.first().click();
await page.waitForFunction(() => document.querySelector(".zr-askteam input")?.checked === true, null, { timeout: 10000 });
await page.waitForTimeout(400);
const card = page.locator("li.zr-item", { hasText: "Open loops finder" });
await card.screenshot({ path: `${OUT}/01-helper-switch.png` });
console.log("run:", JSON.stringify(await (await page.request.post(`${BASE}/dev/run/open-loops`)).json()));
await page.goto(`${BASE}/#inbox`);
const item = page.locator('[data-testid="inbox-item"]', { hasText: "Open loops finder" });
await item.first().waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
await item.first().screenshot({ path: `${OUT}/02-card.png` });
await page.screenshot({ path: `${OUT}/03-inbox.png`, fullPage: true });
console.log("errors:", errors.length ? errors : "none");
await browser.close();
