// E22-L2: the librarian app's screens, desktop 1280 and phone 390, over the demo memory. Usage: shoot.mjs <base> <out dir>
import { chromium } from "playwright-core";
const [BASE, OUT] = process.argv.slice(2);
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const errors = [];
async function open(width, height, to = "#chat") {
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/dev-login?to=${encodeURIComponent(to)}`);
  await page.waitForSelector("text=the librarian of your memory");
  await page.waitForTimeout(700);
  return page;
}
async function say(page, text, wait) {
  await page.locator("textarea").fill(text);
  await page.keyboard.press("Enter");
  await page.waitForSelector(wait, { timeout: 30000 });
  await page.waitForTimeout(500);
}
const shot = (page, name, full = false) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full, animations: "disabled", timeout: 90000 });
const sideways = async (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

// Desktop: the four modes in one chat.
const d = await open(1280, 900);
await shot(d, "desktop-empty");
await say(d, "who are you?", "text=Answered directly");
await say(d, "Ana's birthday is 14 March. She wants the blue notebook from the shop on Verdi street.", "[data-testid=memory-kept]:has-text('Saved')");
await say(d, "What did the plumber quote for the bathroom?", "[data-testid=memory-answer]");
await say(d, "Move the boiler notes under House please, they are filed wrong", "text=Keep this as a memory");
await d.getByRole("button", { name: "Do it as a job" }).click();
await d.waitForSelector("text=Open the inbox");
await say(d, "Let's talk about my running this year. I feel I've gone backwards.", "[data-testid=memory-talk]");
await shot(d, "desktop-chat");
await d.locator("[data-testid=memory-mode]").nth(2).click();
await d.waitForTimeout(300);
await shot(d, "desktop-switch");
await d.keyboard.press("Escape");
await shot(d, "desktop-chat-full", true);
for (const [tab, view, name] of [["Memory", "At a glance", "desktop-glance"], ["Memory", "Tree", "desktop-tree"], ["Memory", "Graph", "desktop-graph"], ["Memory", "Check filings", "desktop-check"], ["Settings", "Usage & plan", "desktop-settings"], ["Settings", "Connect AI apps", "desktop-connect"]]) {
  await d.getByRole("tab", { name: tab }).click();
  await d.getByRole("button", { name: view, exact: true }).click();
  await d.waitForTimeout(1500);
  await shot(d, name);
}
await d.getByRole("tab", { name: "Personas" }).click();
await d.getByRole("button", { name: "Talk it over" }).first().waitFor();
await d.waitForTimeout(500);
await shot(d, "desktop-personas");
await d.getByRole("button", { name: "Talk it over" }).first().click();
await d.waitForSelector("text=You started a talk from Personas");
await d.waitForSelector("text=Want to start there?");
await d.waitForTimeout(500);
await shot(d, "desktop-talk-from-persona");
// Old links keep working: ?tab=graph and #vault open their new home.
const old = await open(1280, 900, "?tab=graph");
const oldGraph = await old.getByRole("button", { name: "Graph", exact: true }).getAttribute("aria-current");
const v = await open(1280, 900, "#account");
const oldVault = await v.getByRole("button", { name: "Account", exact: true }).getAttribute("aria-current");

// Phone.
const p = await open(390, 844);
await say(p, "who are you?", "text=Answered directly");
await say(p, "Let's talk about my running this year. I feel I've gone backwards.", "[data-testid=memory-talk]");
await shot(p, "phone-chat");
const phoneSideways = await sideways(p);
await p.getByRole("tab", { name: "Memory" }).click();
await p.waitForTimeout(1500);
await shot(p, "phone-memory");
await p.getByRole("tab", { name: "Settings" }).click();
await p.getByRole("button", { name: "Usage & plan" }).click();
await p.waitForTimeout(1200);
await shot(p, "phone-settings");
console.log(JSON.stringify({ errors, oldGraph, oldVault, phoneSideways, phoneSidewaysMemory: await sideways(p) }));
await browser.close();
