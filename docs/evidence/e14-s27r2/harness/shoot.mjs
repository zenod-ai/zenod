// E14-S27 round 2 local check, the browser half: the put-away card with Bring it back, the memory card
// still open, Bring it back pressed, and the Helpers tab with the new briefs. Made-up data only.
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
console.log("seed:", JSON.stringify(await (await page.request.post(`${BASE}/dev/seed`)).json()));
await page.goto(`${BASE}/dev-login`);
const card = (from) => page.locator('[data-testid="inbox-item"]', { hasText: from });
await card("Topic gardener").waitFor();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/01-inbox.png`, fullPage: true });
await card("Open loops finder").screenshot({ path: `${OUT}/02-put-away.png` });
await card("Open loops finder").getByRole("button", { name: "Bring it back" }).click();
await card("Open loops finder").getByRole("button", { name: "Do it", exact: true }).waitFor();
await card("Open loops finder").screenshot({ path: `${OUT}/03-brought-back.png` });
const state = await (await page.request.get(`${BASE}/dev/state`)).json();
console.log("cards:", state.inbox.map((i) => `${i.from}: ${i.status}`).join(" | "));
await page.goto(`${BASE}/#helpers`);
await page.getByText("Loose ends in your own life", { exact: false }).first().waitFor({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/04-helpers.png`, fullPage: true });
console.log("errors:", errors.length ? errors : "none");
await browser.close();
