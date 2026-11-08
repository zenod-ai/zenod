import { chromium } from "playwright-core";
const OUT = process.argv[2], URL = process.argv[3];
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const res = {};
for (const [tag, vp, dpr] of [["desktop", { width: 1440, height: 900 }, 1], ["phone", { width: 390, height: 844 }, 2]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dpr, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(URL, { waitUntil: "load" });
  await page.addStyleTag({ content: ".pp-nav{position:static !important}" });
  for (const id of ["graph", "strength"]) {
    const el = page.locator(`#${id}`);
    await el.scrollIntoViewIfNeeded();
    await page.evaluate(async () => { for (const i of document.images) { i.loading = "eager"; if (!i.complete) await new Promise(r => { i.onload = i.onerror = r; }); } });
    await page.waitForTimeout(1500);
    await el.screenshot({ path: `${OUT}/${id}-${tag}.png` });
  }
  res[tag] = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    tags: [...document.querySelectorAll(".pp-tag")].map(t => t.textContent), imgs: [...document.querySelectorAll(".pp-real img")].map(i => [i.currentSrc.split("/").pop(), i.naturalWidth]) }));
  await ctx.close();
}
console.log(JSON.stringify(res, null, 1));
await browser.close();
