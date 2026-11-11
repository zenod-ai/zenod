// E26-S15 local check, the browser half: a new tester walks the five steps and the card ticks each one
// from real state, without a reload (the card reads the server every 15 s and on focus). Made-up data only.
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const errors = [];
async function run(width, height, prefix) {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/dev-login`);
  return page;
}
const card = (page) => page.locator('[data-testid="quick-start"]');
const score = async (page, text) => page.locator('[data-testid="quick-start-score"]', { hasText: text }).waitFor({ timeout: 30000 });
const refresh = (page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));
const shot = async (page, name) => { await page.waitForTimeout(500); await card(page).screenshot({ path: `${OUT}/${name}.png` }); };

const page = await run(1100, 1100);
await score(page, "0 of 5");
await shot(page, "01-new");
await page.screenshot({ path: `${OUT}/00-app.png` });

await page.request.post(`${BASE}/dev/whatsapp`); await refresh(page); await score(page, "1 of 5");
await shot(page, "02-whatsapp");
await page.request.post(`${BASE}/dev/claude`); await refresh(page); await score(page, "2 of 5");
await shot(page, "03-claude");
await page.request.post(`${BASE}/dev/filed`); await refresh(page); await score(page, "3 of 5");
await shot(page, "04-kept");
// Step 4 through the real route the app's search uses: the made-up memory names Piranesi.
const found = await page.request.get(`${BASE}/api/console/memory-search?q=Piranesi`);
console.log("search:", found.status(), JSON.stringify((await found.json()).results?.map((r) => r.path)));
await refresh(page); await score(page, "4 of 5");
await shot(page, "05-found");
// Step 5 in the card itself: switch one helper on.
await page.locator('.qs-sw[aria-label="Weekly recap"]').waitFor({ timeout: 20000 });
await shot(page, "06-helpers");
await page.locator('.qs-sw[aria-label="Weekly recap"]').click();
await page.getByText("5 of 5. You’re all set.").waitFor({ timeout: 20000 });
await shot(page, "07-done");
console.log("state:", JSON.stringify(await (await page.request.get(`${BASE}/dev/state`)).json()));

// While helpers are still building (the live switch for testers today): four steps, out of four.
await page.request.post(`${BASE}/dev/building/1`);
const phone = await run(390, 1300);
// The card was closed at 5 of 5 above? It was not: show it again from the state the server keeps.
await phone.locator('[data-testid="quick-start"]').waitFor({ timeout: 20000 });
await phone.waitForTimeout(500);
await phone.locator('[data-testid="quick-start"]').screenshot({ path: `${OUT}/08-phone-building.png` });
console.log("errors:", errors.length ? errors : "none");
await browser.close();
