// E15-S1: ask "who are you?" in the app chat and screenshot the reply.
import { chromium } from "playwright-core";
const [BASE, OUT, Q = "who are you?"] = process.argv.slice(2);
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`${BASE}/dev-login`);
await page.waitForSelector("textarea");
await page.waitForTimeout(800);
await page.locator("textarea").pressSequentially(Q, { delay: 30 });
await page.keyboard.press("Enter");
await page.waitForSelector("[data-testid=memory-answer]", { timeout: 30000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT });
console.log((await page.locator("[data-testid=memory-answer]").innerText()).slice(0, 160).replace(/\n/g, " "));
await browser.close();
