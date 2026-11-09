// E14-S26 local check, the browser half: every button on a made-up suggestion, the voice note through
// Chromium's fake microphone (voice.wav, made with a local text-to-speech voice), screenshots.
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const CLIP = process.argv[4];
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${CLIP}`] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const state = async () => (await page.request.get(`${BASE}/dev/state`)).json();
const card = (text) => page.locator('[data-testid="inbox-item"]', { hasText: text });
const log = (...a) => console.log(...a);

await page.goto(`${BASE}/dev-login`);
const gardener = card("Boat repair and Cabin decision are two things");
await gardener.waitFor();
await page.waitForTimeout(800);
log("tabs:", (await page.getByRole("tab").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).join(" | "));
await page.screenshot({ path: `${OUT}/01-inbox-suggestions.png` });

// Your feedback: a text box with a microphone; a typed line and a voice note.
await gardener.getByRole("button", { name: "Your feedback" }).click();
await gardener.getByRole("textbox").fill("Mostly yes.");
await gardener.getByRole("button", { name: "Leave a voice note" }).click();
await page.waitForTimeout(7500);
await page.screenshot({ path: `${OUT}/02-recording.png` });
await gardener.getByRole("button", { name: "Send voice note" }).click();
await gardener.getByText(/Oakmere/).waitFor({ timeout: 90_000 });
await page.waitForTimeout(500);
log("voice feedback on the card:", (await gardener.locator(".zi-replies").innerText()).replace(/\s+/g, " "));
await gardener.screenshot({ path: `${OUT}/03-voice-feedback.png` });
log("helper will read:", JSON.stringify((await state()).unread));

// Do it: one desk job on the card, then Undo.
await gardener.getByRole("button", { name: "Do it", exact: true }).click();
await gardener.getByText(/Done on the memory desk/).waitFor({ timeout: 60_000 });
await gardener.getByRole("button", { name: "See the changes" }).click();
await page.waitForTimeout(500);
await gardener.screenshot({ path: `${OUT}/04-do-it-done.png` });
let s = await state();
log("after Do it: commits", JSON.stringify(s.commits.slice(0, 2)), "| desk request:", JSON.stringify(s.deskRequests[0]), "| copied note on cabin page:", s.cabinPage.includes("e-222222"));
log("cards shown:", await page.locator('[data-testid="inbox-item"]').count());
await gardener.getByRole("button", { name: "Undo" }).click();
await gardener.getByRole("button", { name: "Yes, put it back" }).click();
await gardener.getByText(/Undone\. Your memory is as it was before\./).waitFor({ timeout: 60_000 });
await gardener.screenshot({ path: `${OUT}/05-undone.png` });
s = await state();
log("after Undo: commits", JSON.stringify(s.commits.slice(0, 3)), "| copied note back on cabin page:", s.cabinPage.includes("e-222222"));

// Change: edit the words first, then Do it like this.
const people = card("Add to Ana's page");
await people.getByRole("button", { name: "Change" }).click();
await people.getByRole("textbox", { name: "The change, in your words" }).fill("Add a line to People › Ana: the blue notebook from the shop on Verdi street, before 14 March.");
await page.waitForTimeout(300);
await people.screenshot({ path: `${OUT}/06-change.png` });
await people.getByRole("button", { name: "Do it like this" }).click();
await people.getByText(/You changed it first/).waitFor({ timeout: 60_000 });
await people.getByText(/Done on the memory desk|Stopped\.|Nothing changed/).first().waitFor({ timeout: 60_000 }).catch(() => {});
await people.screenshot({ path: `${OUT}/07-changed-done.png` });
s = await state();
log("Change ran the user's words:", JSON.stringify(s.deskRequests[1]));

// Not now, with a reason.
const ideas = card("boat-sharing idea");
await ideas.getByRole("button", { name: "Not now" }).click();
await ideas.getByRole("textbox", { name: "Why not now" }).fill("I already dropped that idea");
await ideas.getByRole("button", { name: "Put it away" }).click();
await ideas.getByText("“I already dropped that idea”").waitFor();
await ideas.screenshot({ path: `${OUT}/08-not-now.png` });
log("not now card:", (await ideas.innerText()).replace(/\s+/g, " ").slice(0, 300));

// Talk it over opens the chat with that helper.
await ideas.getByRole("button", { name: "Talk it over" }).click();
await page.waitForTimeout(800);
log("talk it over ->", decodeURIComponent(new URL(page.url()).hash).slice(0, 120));

// Helpers tab: the rename and the one line.
await page.goto(`${BASE}/#helpers`);
await page.getByTestId("helpers-what").waitFor();
log("helpers line:", await page.getByTestId("helpers-what").innerText());
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/09-helpers.png` });
await page.goto(`${BASE}/#personas`);
await page.getByTestId("helpers-what").waitFor();
log("old #personas link opens:", await page.locator("#memory-personas-heading").innerText());

// Inbox on a phone.
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await m.newPage();
await mp.goto(`${BASE}/dev-login`);
await mp.locator('[data-testid="inbox-item"]').first().waitFor();
await mp.waitForTimeout(800);
await mp.screenshot({ path: `${OUT}/10-phone.png`, fullPage: true });
log("phone scrolls sideways:", await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
log("page errors:", errors.length ? errors : "none");
await browser.close();
