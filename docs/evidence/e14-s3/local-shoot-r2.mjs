// E14-S3 round 2 local check, headless Chromium against local-desk.mjs (serve mode, demo vault,
// DESK_NOW=2026-10-07T12:00:00Z so the demo notes fall in the last 7 days). Jordi's own question.
//   node local-shoot-r2.mjs <screenshot dir> <port>
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
const log = (...a) => console.log(...a);

await page.goto(`${BASE}/dev-login?to=inbox`);
await page.getByRole("textbox", { name: "A job for the memory desk" }).waitFor();
await page.getByRole("textbox", { name: "A job for the memory desk" }).fill("How many root memories added to in last 7 days?");
await page.getByRole("button", { name: "Start the job" }).click();
const card = page.locator("[data-testid=inbox-item]").filter({ hasText: "How many root memories" }).first();
await card.waitFor({ timeout: 5_000 });
log("at once:", (await card.innerText()).split("\n").slice(0, 3).join(" / "));
await card.getByText("This was a question").or(card.getByText(/Stopped/)).first().waitFor({ timeout: 120_000 });
log("then:", (await card.innerText()).split("\n").slice(0, 5).join(" / "));
await page.screenshot({ path: `${OUT}/12-question-answered.png` });
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await card.waitFor();
await page.screenshot({ path: `${OUT}/13-question-phone.png` });
await browser.close();
