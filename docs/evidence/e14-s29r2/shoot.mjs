// E14-S29 round 2: a question, then "I meant …", on the made-up memory of the round 1 harness
// (../e14-s29/harness: seed.py, serve.mjs). The follow-up is answered, never passed to the desk.
// Usage: NODE_PATH=<worktree>/node_modules node shoot.mjs <base> <out dir>
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
async function say(page, text, replies) {
  await page.locator("textarea").fill(text);
  await page.keyboard.press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll("[data-testid=memory-did]").length >= n, replies, { timeout: 30000 });
  await page.waitForTimeout(600);
}
const did = (page) => page.locator("[data-testid=memory-did]").allTextContents();
const desk = (page) => page.locator("[data-testid=memory-desk]").count();
const d = await open(1280, 1100);
await say(d, "What did the agent say?", 1);
await say(d, "I meant about the flat", 2);
await d.screenshot({ path: `${OUT}/desktop-follow-up.png`, animations: "disabled" });
const p = await open(390, 844);
await say(p, "What did the agent say?", 1);
await say(p, "I meant about the flat", 2);
await p.locator("[data-testid=memory-did]").nth(1).evaluate((el) => el.scrollIntoView({ block: "start" }));
await p.waitForTimeout(300);
await p.screenshot({ path: `${OUT}/phone-follow-up.png`, animations: "disabled" });
const sideways = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log(JSON.stringify({ errors, did: await did(d), deskLines: await desk(d), readAs: await d.locator("[data-testid=memory-read-as]").allTextContents(), sideways }));
await browser.close();
