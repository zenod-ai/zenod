// E14-S36 local check, the browser half: every card before and after, on a laptop and a phone width.
// Usage: node shoot.mjs <out dir> <port> <prefix>
import { chromium } from "playwright-core";
const [OUT, PORT, PREFIX = ""] = process.argv.slice(2);
const BASE = `http://127.0.0.1:${PORT}`;
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const errors = [];
for (const [width, tag] of [[1000, ""], [390, "-phone"]]) {
  const page = await (await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  for (const shape of ["before", "after"]) {
    await page.request.post(`${BASE}/dev/seed?shape=${shape}`);
    await page.goto(`${BASE}/dev-login`);
    await page.locator('[data-testid="inbox-item"]').first().waitFor();
    await page.waitForTimeout(700);
    const cards = page.locator('[data-testid="inbox-item"]');
    const n = await cards.count();
    for (let i = 0; i < n; i++) await cards.nth(i).screenshot({ path: `${OUT}/${PREFIX}${shape}-${i + 1}${tag}.png` });
    console.log(shape + tag, n, "cards");
  }
}
console.log("errors:", errors.length ? errors : "none");
await browser.close();
