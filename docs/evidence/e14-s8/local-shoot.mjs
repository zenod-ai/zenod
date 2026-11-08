// E14-S8 local check, driven in headless Chromium against local-call.mjs (serve mode, demo vault,
// web app built with VITE_ZENOD_CALL_STUB=1: the recorded Realtime session plays the call).
//   node local-shoot.mjs <screenshot dir> <port> [off]
// "off": the server runs with CALL_KEY=off (no key): only the not-switched-on shots.
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const OFF = process.argv[4] === "off";
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const log = (...a) => console.log(...a);

if (OFF) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${BASE}/dev-login?to=chat`);
  const button = page.getByTestId("memory-call-button");
  await button.waitFor();
  await page.waitForFunction(() => document.querySelector("[data-testid=memory-call-button]")?.getAttribute("aria-disabled") === "true");
  // aria-disabled, not disabled: a person can still press it and is told why (Playwright needs force).
  await button.click({ force: true });
  await page.getByText("Calls are not switched on yet.").last().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/05-not-switched-on.png` });
  log("off:", await button.getAttribute("title"));
  await browser.close();
  process.exit(0);
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: `${OUT}/video`, size: { width: 1280, height: 900 } } });
const page = await ctx.newPage();
page.on("pageerror", (e) => log("pageerror", e.message));
await page.goto(`${BASE}/dev-login?to=chat`);
const button = page.getByTestId("memory-call-button");
await button.waitFor();
await page.waitForFunction(() => !document.querySelector("[data-testid=memory-call-button]")?.hasAttribute("aria-disabled"));
await page.screenshot({ path: `${OUT}/01-call-button.png` });
await page.waitForTimeout(800);
await button.click();
await page.getByText(/Ana the plumber fixed the boiler/).last().waitFor({ timeout: 30_000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/02-call-answer.png` });
await page.getByText(/Passed to the memory desk/).waitFor({ timeout: 30_000 });
await page.getByTestId("memory-call-ended").waitFor({ timeout: 30_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/03-call-ended.png` });
await page.getByRole("button", { name: "Keep the call" }).click();
await page.getByText(/being kept as a memory/).waitFor();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/04-kept.png` });
log("minted:", JSON.stringify(await (await page.request.get(`${BASE}/dev/minted`)).json()));
log("calls:", JSON.stringify(await (await page.request.get(`${BASE}/dev/calls`)).json()));
// The desk job the call passed on, in the inbox.
await page.goto(`${BASE}/#inbox`);
await page.locator("[data-testid=inbox-item]").filter({ hasText: /cabin/i }).first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/06-inbox-job.png` });
await ctx.close();

// The same call on a phone.
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
await phone.goto(`${BASE}/dev-login?to=chat`);
await phone.waitForFunction(() => !document.querySelector("[data-testid=memory-call-button]")?.hasAttribute("aria-disabled"));
await phone.getByTestId("memory-call-button").click();
await phone.getByText(/Ana the plumber fixed the boiler/).last().waitFor({ timeout: 30_000 });
await phone.waitForTimeout(500);
await phone.screenshot({ path: `${OUT}/07-phone.png` });
await phone.getByTestId("memory-call-ended").waitFor({ timeout: 30_000 });
await browser.close();
