// E14-S29: the chat's "Read as" line and its correction, desktop 1280 and phone 390, over the demo memory.
// Usage: shoot.mjs <base> <out dir>
import { chromium } from "playwright-core";
const [BASE, OUT] = process.argv.slice(2);
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const errors = [];
async function open(width, height) {
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/dev-login?to=${encodeURIComponent("#chat")}`);
  await page.waitForSelector("text=the librarian of your memory");
  await page.waitForTimeout(700);
  return page;
}
async function say(page, text, count) {
  await page.locator("textarea").fill(text);
  await page.keyboard.press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll("[data-testid=memory-read-as]").length >= n, count, { timeout: 30000 });
  await page.waitForTimeout(500);
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
const p = await open(390, 844);
await say(p, "What did the agent say about the flat?", 1);
await p.locator("[data-testid=memory-mode]").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
await p.waitForTimeout(300);
await shot(p, "phone-read-as");
const d = await open(1280, 1250);
await say(d, "What did the agent say about the flat?", 1);
await say(d, "and Ana's thing?", 2);
await say(d, "where am I with that cello thing?", 3);
await shot(d, "desktop-read-as");
await d.locator(".zp-readas-btn").first().click();
await d.waitForTimeout(200);
await d.waitForSelector(".zp-readas-find");
await d.waitForTimeout(500);
await shot(d, "desktop-correct");
await d.locator(".zp-readas-find").fill("cabin");
await d.waitForTimeout(300);
await d.locator(".zp-readas-menu button").first().click();
await d.waitForSelector("text=this way from now on");
await d.waitForTimeout(300);
await shot(d, "desktop-corrected");
// The next message reads the corrected words the new way.
await say(d, "any news on the flat?", 4);
const after = await d.locator("[data-testid=memory-read-as]").nth(3).textContent();
await shot(d, "desktop-learned");
const sideways = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log(JSON.stringify({ errors, after, sideways }));
await browser.close();
