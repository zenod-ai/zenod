// E14-S10 local check, the browser half: the Usage tab for a typical and a heavy user, desktop and phone.
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
async function shoot(who, file, viewport, scale = 1) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(`${BASE}/dev-login?who=${who}`);
  await page.getByRole("tab", { name: /Usage/ }).click();
  await page.getByTestId("usage-by-feature").waitFor();
  await page.waitForTimeout(500);
  console.log(who, ":", (await page.getByTestId("usage-by-feature").innerText()).replace(/\s+/g, " ").slice(0, 900));
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  await ctx.close();
}
await shoot("typical", "01-usage-typical.png", { width: 1280, height: 900 });
await shoot("heavy", "02-usage-heavy.png", { width: 1280, height: 900 });
await shoot("typical", "03-phone.png", { width: 390, height: 844 }, 2);
await browser.close();
