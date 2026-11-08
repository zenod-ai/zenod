// E14-S3 local check, driven in headless Chromium against local-desk.mjs (serve mode, demo vault).
//   node local-shoot.mjs <screenshot dir> <port>
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = `http://127.0.0.1:${process.argv[3]}`;
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
const log = (...a) => console.log(...a);
const head = async () => (await (await page.request.get(`${BASE}/dev/head`)).json()).log;

await page.goto(`${BASE}/dev-login?to=chat`);
await page.getByRole("button", { name: "Ask the desk" }).waitFor();
await page.screenshot({ path: `${OUT}/01-chat.png` });

// 1. A job typed into the one Send box: Zenod's chat model decides it is a job.
const JOB = "Boat and cabin are tangled, they are two separate things, please split them";
await page.getByRole("textbox", { name: "Message your memory" }).fill(JOB);
await page.getByRole("button", { name: "Send", exact: true }).click();
await page.getByTestId("memory-desk").waitFor({ timeout: 60_000 });
log("send reply:", (await page.getByTestId("memory-did").last().innerText()).trim());
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/02-chat-job.png` });

// 2. The inbox: Working with its step, then Done.
await page.getByRole("link", { name: "Open the inbox" }).click();
const card = page.locator("[data-testid=inbox-item]").filter({ hasText: "Boat" }).first();
await card.waitFor();
log("inbox first sight:", (await card.innerText()).split("\n").slice(0, 4).join(" / "));
await page.screenshot({ path: `${OUT}/03-working.png` });
await card.getByRole("button", { name: "See the changes" }).waitFor({ timeout: 120_000 });
await card.getByRole("button", { name: "See the changes" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/04-done.png`, fullPage: true });
log("vault after job:", (await head())[0]);

// 3. Ask the desk from the inbox: shows at once as Working.
await page.getByRole("textbox", { name: "A job for the memory desk" }).fill("Link the Garden page to the House page");
await page.getByRole("button", { name: "Start the job" }).click();
const second = page.locator("[data-testid=inbox-item]").filter({ hasText: "Link the Garden page" }).first();
await second.waitFor({ timeout: 5_000 });
log("ask the desk, at once:", (await second.innerText()).split("\n").slice(0, 3).join(" / "));
await page.screenshot({ path: `${OUT}/05-ask-desk.png` });
await second.getByRole("button", { name: "See the changes" }).or(second.getByText(/Stopped at/)).first().waitFor({ timeout: 120_000 });
log("second job:", (await second.innerText()).split("\n").slice(0, 4).join(" / "));
log("vault after second job:", (await head())[0]);

// 4. Undo the first job: one more commit, the tree as before.
await card.getByRole("button", { name: "Undo" }).click();
await card.getByRole("button", { name: "Yes, put it back" }).click();
await card.getByText("Your memory is as it was before the job.").waitFor({ timeout: 60_000 });
await page.screenshot({ path: `${OUT}/06-undone.png`, fullPage: true });
log("vault after undo:", (await head()).slice(0, 4).join(" | "));

// 5. A WhatsApp message that reads like a job: only "run it?" in the inbox.
await page.request.post(`${BASE}/dev/whatsapp`, { data: { content: "Move the boiler notes under House please, they are filed wrong" } });
await page.reload();
await page.getByText("This message looks like a job on your memory. Run it?").waitFor();
await page.screenshot({ path: `${OUT}/07-whatsapp-run-it.png` });

// Phone width.
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.getByText("Ask the desk").first().waitFor();
await page.screenshot({ path: `${OUT}/08-phone.png`, fullPage: true });
await browser.close();
