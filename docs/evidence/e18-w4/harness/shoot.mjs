// E18-W4: real screens of the graph view and a lit answer, demo vault, 2x, for the zenod.dev landing.
import { chromium } from "playwright-core";
const OUT = process.argv[2], BASE = "http://127.0.0.1:18971";
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const Q = "How are we financing Westcombe?";
async function run(vp, tag) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev-login`);
  await page.waitForSelector("textarea");
  await page.goto(`${BASE}/#graph?path=${encodeURIComponent("Projects/Westcombe.md")}`);
  await page.waitForSelector("svg.zp-g line.zp-gweighted");
  await page.waitForTimeout(2000);
  await page.locator(".zp-graphgrid .zp-stage").screenshot({ path: `${OUT}/graph-${tag}.png` });
  await page.goto(`${BASE}/#chat`);
  await page.waitForSelector("textarea");
  await page.locator("textarea").fill(Q);
  await page.keyboard.press("Enter");
  await page.waitForSelector("[data-testid=show-in-graph]");
  await page.waitForTimeout(800);
  await page.locator("[data-testid=show-in-graph]").click();
  await page.waitForSelector("svg.zp-g .zp-glit");
  await page.waitForTimeout(3500);
  await page.locator(".zp-graphgrid").screenshot({ path: `${OUT}/lit-${tag}.png` });
  await ctx.close();
}
await run({ width: 1440, height: 960 }, "desktop");
await run({ width: 390, height: 844 }, "phone");
await browser.close();
