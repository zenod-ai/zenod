// E12-S27 local check: the Memory tab lists Zenod's least sure filings first; Wrong place moves one under the
// branch you pick (one commit), the tree shows it there, Undo puts it back.
//   node shoot.mjs <out dir> <base url> <page to move> <search words> [prefix]
import { chromium } from "playwright-core";
const [OUT, BASE, MOVE, WHERE, TO_ROOT, PREFIX = ""] = process.argv.slice(2);
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: `${OUT}/${PREFIX}${name}.png` });
await page.goto(`${BASE}/dev-login`);
await page.waitForSelector("[data-testid=memory-review-card]");
await page.waitForTimeout(600);
const summary = await page.locator("[data-testid=memory-review-summary]").textContent();
const first = await page.$$eval("[data-testid=review-item]", (els) => els.slice(0, 6).map((e) => e.innerText.split("\n").slice(0, 3).join(" | ")));
await shot("01-review");
// The tree's root branches, as it opens.
await page.locator("[data-testid=memory-tree-card]").screenshot({ path: `${OUT}/${PREFIX}02-tree.png` });
const roots = await page.$$eval("[data-testid=memory-tree-card] [role=tree] > li > ul > li", (els) => els.length);
// Wrong place on the least sure one we want to move.
const item = page.locator("[data-testid=review-item]").filter({ hasText: MOVE }).first();
await item.scrollIntoViewIfNeeded();
await item.getByRole("button", { name: /Wrong place/ }).click();
await page.locator("[data-testid=move-picker] input").pressSequentially(WHERE, { delay: 40 });
await page.waitForTimeout(300);
await item.screenshot({ path: `${OUT}/${PREFIX}03-picker.png` });
const t0 = Date.now();
await page.locator("[data-testid=move-picker] li button").first().click();
await page.waitForSelector("[data-sonner-toast]");
const moveMs = Date.now() - t0;
await page.waitForFunction((was) => document.querySelector("[data-testid=memory-review-summary]")?.textContent !== was, summary);
await page.waitForTimeout(500);
const toast = await page.locator("[data-sonner-toast]").first().innerText();
await page.evaluate(() => window.scrollTo(0, 0));
await shot("04-moved");
const after = await page.locator("[data-testid=memory-review-summary]").textContent();
// On the tree: the branch it went to, with the moved page opened.
await page.getByRole("button", { name: `Expand ${TO_ROOT}`, exact: true }).click();
const movedRow = page.locator("[role=tree] button", { hasText: MOVE }).first();
await movedRow.scrollIntoViewIfNeeded();
await movedRow.click();
await page.waitForTimeout(300);
const box = await movedRow.boundingBox();
await page.screenshot({ path: `${OUT}/${PREFIX}04b-on-tree.png`, clip: { x: 150, y: Math.max(0, box.y - 260), width: 980, height: 420 } });
// Undo from the latest moves.
await page.waitForTimeout(4500);
await page.getByRole("button", { name: /Undo/ }).first().click();
await page.waitForFunction(() => [...document.querySelectorAll("[data-sonner-toast]")].some((t) => /back where it was/.test(t.textContent ?? "")));
await page.waitForFunction((was) => document.querySelector("[data-testid=memory-review-summary]")?.textContent !== was, after);
await page.waitForTimeout(400);
await shot("05-undone");
const undone = await page.locator("[data-testid=memory-review-summary]").textContent();
await ctx.close();
// Phone.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p2 = await phone.newPage();
await p2.goto(`${BASE}/dev-login`);
await p2.waitForSelector("[data-testid=memory-review-card]");
await p2.waitForTimeout(600);
await p2.screenshot({ path: `${OUT}/${PREFIX}06-phone.png` });
await phone.close();
await browser.close();
console.log(JSON.stringify({ roots, summary, first, toast, moveMs, after, undone, errors }, null, 1));
