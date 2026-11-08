// E14-S2 round 3 local check, the browser half: the inbox as cards with a reply box each, no second
// chat; feedback to a persona read on its next run; a follow-up to the desk as a new linked job.
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
const card = (text) => page.locator('[data-testid="inbox-item"]').filter({ hasText: text });
await page.goto(`${BASE}/dev-login`);
// Demo data: Weekly recap runs once (stub model), a desk job given as if from the Chat, and the examples.
await page.goto(`${BASE}/#personas`);
await page.getByRole("button", { name: "Run now" }).first().click();
await page.getByText(/posted one finding/).waitFor({ timeout: 30000 });
const started = await page.request.post(`${BASE}/api/console/memory-desk/jobs`, { data: { request: "Split Boat repair and Cabin decision" } });
console.log("desk job:", started.status());
await page.goto(`${BASE}/#inbox`);
await page.getByRole("button", { name: "Show examples" }).click().catch(() => {});
await page.waitForTimeout(500);
if (await page.getByText("Clear examples").count() === 0) await page.request.post(`${BASE}/api/console/inbox/examples`);
await page.reload();
await card("Split Boat repair").getByText(/Done: Split/).waitFor({ timeout: 15000 });
console.log("text boxes on the inbox:", await page.getByRole("textbox").count(), "cards:", await page.locator('[data-testid="inbox-item"]').count());
console.log("Ask the desk box in the inbox:", await page.getByRole("button", { name: "Start the job" }).count());
await page.screenshot({ path: `${OUT}/01-inbox-cards.png`, fullPage: true });

// Feedback to the persona on its finding.
const finding = card("dentist twice this week");
await finding.getByRole("textbox").fill("I booked it yesterday. Flag things I keep postponing, not ones I already did.");
await finding.getByRole("button", { name: "Send feedback" }).click();
await finding.getByText(/^Sent\. Weekly recap reads it/).waitFor();
await finding.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/02-feedback-sent.png` });
// Its next run reads it.
await page.goto(`${BASE}/#personas`);
await page.getByRole("button", { name: "Run now" }).first().click();
await page.waitForTimeout(2500);
await page.goto(`${BASE}/#inbox`);
await page.reload();
await card("I booked it yesterday").first().getByText(/read it on its run/).waitFor({ timeout: 15000 });
console.log("finding card:", (await card("I booked it yesterday").first().locator(".zi-replies").innerText()).replace(/\s+/g, " "));
await card("I booked it yesterday").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/03-feedback-read.png` });

// A follow-up to the desk on the finished job.
const job = card("Split Boat repair and Cabin decision").filter({ hasNotText: "Example" }).filter({ hasText: /Done: Split/ });
await job.getByRole("textbox").fill("Also move the Yard quotes to Boat repair");
await job.getByRole("button", { name: "Send to the desk" }).click();
await job.getByText(/Sent to the desk as a new job/).waitFor();
const follow = card("Follows up");
await follow.getByText(/Done: Also move/).waitFor({ timeout: 15000 });
console.log("follow-up card:", (await follow.innerText()).replace(/\s+/g, " ").slice(0, 300));
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${OUT}/04-followup.png`, fullPage: true });

// Answer the example question in words.
const q = card("look like the same place");
await q.getByRole("textbox").fill("Join them under Home instead");
await q.getByRole("button", { name: "Send answer" }).click();
await q.getByText(/You answered “Join them under Home instead”/).waitFor();
console.log("question card:", (await q.innerText()).replace(/\s+/g, " ").slice(0, 200));
await page.screenshot({ path: `${OUT}/05-after-replies.png`, fullPage: true });

const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await m.newPage();
await mp.goto(`${BASE}/dev-login`);
await mp.locator('[data-testid="inbox-item"]').first().waitFor();
await mp.waitForTimeout(800);
await mp.screenshot({ path: `${OUT}/06-phone.png`, fullPage: true });
await browser.close();
