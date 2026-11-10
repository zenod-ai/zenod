// E14-S27 local check, the browser half: the five helpers' real suggestions in the inbox, Do it on two
// of them through the real desk (DeepSeek through the relay), Undo, Not now with a reason that the
// helper then reads on its next run, the Helpers tab and the phone. Screenshots only of made-up data.
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const state = async () => (await page.request.get(`${BASE}/dev/state`)).json();
const file = async (path) => (await page.request.get(`${BASE}/dev/file?path=${encodeURIComponent(path)}`)).text();
const card = (from) => page.locator('[data-testid="inbox-item"]', { hasText: from });
const log = (...a) => console.log(...a);

await page.goto(`${BASE}/dev-login`);
await card("Topic gardener").waitFor();
await page.waitForTimeout(800);
log("cards:", (await state()).inbox.map((i) => `${i.from}: ${i.kind}`).join(" | "));
await page.screenshot({ path: `${OUT}/01-inbox.png`, fullPage: true });

// Do it on Topic gardener's suggestion: the real desk runs it as one job.
const gardener = card("Topic gardener");
log("boiler parent before:", (await file("Notes/Boiler.md")).match(/^parent: .*$/m)?.[0]);
await gardener.getByRole("button", { name: "Do it", exact: true }).click();
await gardener.getByText(/Done on the memory desk|Stopped|Nothing changed|needs your yes/i).first().waitFor({ timeout: 180_000 });
await page.waitForTimeout(500);
const seeChanges = gardener.getByRole("button", { name: "See the changes" });
if (await seeChanges.count()) await seeChanges.click();
await page.waitForTimeout(500);
await gardener.screenshot({ path: `${OUT}/02-gardener-done.png` });
let s = await state();
log("after Do it: commits", JSON.stringify(s.commits.slice(0, 2)), "| boiler parent:", (await file("Notes/Boiler.md")).match(/^parent: .*$/m)?.[0]);
log("gardener card:", (await gardener.innerText()).replace(/\s+/g, " ").slice(0, 500));

// Undo puts it back.
const undo = gardener.getByRole("button", { name: "Undo" });
if (await undo.count()) {
  await undo.click();
  await gardener.getByRole("button", { name: "Yes, put it back" }).click();
  await gardener.getByText(/Undone\. Your memory is as it was before\./).waitFor({ timeout: 60_000 });
  await gardener.screenshot({ path: `${OUT}/03-gardener-undone.png` });
  s = await state();
  log("after Undo: commits", JSON.stringify(s.commits.slice(0, 3)), "| boiler parent:", (await file("Notes/Boiler.md")).match(/^parent: .*$/m)?.[0]);
}

// Do it on Ideas digest's suggestion.
const ideas = card("Ideas digest");
await ideas.getByRole("button", { name: "Do it", exact: true }).click();
await ideas.getByText(/Done on the memory desk|Stopped|Nothing changed|needs your yes/i).first().waitFor({ timeout: 180_000 });
await page.waitForTimeout(500);
await ideas.screenshot({ path: `${OUT}/04-ideas-done.png` });
s = await state();
log("ideas Do it: commits", JSON.stringify(s.commits.slice(0, 2)), "| card:", (await ideas.innerText()).replace(/\s+/g, " ").slice(0, 400));

// Not now with a reason on People and follow-ups; its next run reads it.
const people = card("People and follow-ups");
await people.getByRole("button", { name: "Not now" }).click();
await people.getByRole("textbox", { name: "Why not now" }).fill("Ana is already under People");
await people.getByRole("button", { name: "Put it away" }).click();
await people.getByText("“Ana is already under People”").waitFor();
await people.screenshot({ path: `${OUT}/05-not-now.png` });
const rerun = await (await page.request.post(`${BASE}/dev/run/people-follow-ups`)).json();
const call = rerun.calls[0] ?? {};
log("people rerun:", rerun.run.status, rerun.run.summary);
log("its system words carry the reason:", (call.system ?? "").includes("Not now: Ana is already under People"));
log("its prompt lists the earlier suggestion:", (call.prompt ?? "").split("\n").filter((l) => l.startsWith("- not now")).join(" / "));
log("its new suggestion:", JSON.stringify((await state()).inbox.filter((i) => i.from === "People and follow-ups").map((i) => [i.status, i.action])));

// Helpers tab and the phone.
await page.goto(`${BASE}/#helpers`);
await page.getByTestId("helpers-what").waitFor();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/06-helpers.png`, fullPage: true });
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await m.newPage();
await mp.goto(`${BASE}/dev-login`);
await mp.locator('[data-testid="inbox-item"]').first().waitFor();
await mp.waitForTimeout(800);
await mp.screenshot({ path: `${OUT}/07-phone.png` });
log("phone scrolls sideways:", await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
log("page errors:", errors.length ? errors : "none");
await browser.close();
