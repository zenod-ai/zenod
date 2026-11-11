// Zenod social kit renderer: every asset at its exact platform size, from src/ with the real fonts.
// Run: PW=<path to a playwright package> node docs/brand/social-kit/render.mjs docs/brand/social-kit/previews
// Fails if a font did not load (no fallback text ever ships).
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || "playwright");
const kit = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(kit, "assets");
const evidence = process.argv[2];
fs.mkdirSync(out, { recursive: true });

const avatars = [
  ["zenod-avatar-1024.png", 1024], // master; TikTok and any new profile
  ["zenod-avatar-x-400.png", 400],
  ["zenod-avatar-youtube-800.png", 800],
  ["zenod-avatar-instagram-1080.png", 1080],
  ["zenod-avatar-linkedin-400.png", 400],
];
const banners = [
  ["zenod-banner-x-1500x500.png", "x", 1500, 500],
  ["zenod-banner-youtube-2560x1440.png", "youtube", 2560, 1440],
  ["zenod-banner-linkedin-1128x191.png", "linkedin", 1128, 191],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const svg = pathToFileURL(path.join(kit, "src/zenod-avatar.svg")).href;
const home = pathToFileURL(path.join(kit, "src/banner.html")).href; // file: origin so setContent can load local files

for (const [name, s] of avatars) {
  await page.setViewportSize({ width: s, height: s });
  await page.goto(home);
  await page.setContent(`<style>*{margin:0}html,body{width:${s}px;height:${s}px;overflow:hidden}</style><img src="${svg}" width="${s}" height="${s}" style="display:block">`);
  await page.waitForLoadState("load");
  await page.screenshot({ path: path.join(out, name), clip: { x: 0, y: 0, width: s, height: s } });
}
fs.copyFileSync(path.join(kit, "src/zenod-avatar.svg"), path.join(out, "zenod-avatar.svg"));

for (const [name, p, w, h] of banners) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(pathToFileURL(path.join(kit, "src/banner.html")).href + "?p=" + p);
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(() => document.fonts.check('500 40px "Newsreader"') && document.fonts.check('500 20px "Instrument Sans"') && [...document.fonts].every((f) => f.status === "loaded"));
  if (!ok) throw new Error("font did not load for " + name);
  const box = await page.evaluate(() => { const r = document.querySelector(".block").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
  console.log(name, "text box", JSON.stringify(box));
  await page.screenshot({ path: path.join(out, name), clip: { x: 0, y: 0, width: w, height: h } });
}

// Evidence: each profile as the platform lays it out (avatar crop over the banner), at real display size.
if (evidence) {
  fs.mkdirSync(evidence, { recursive: true });
  const a = (n) => pathToFileURL(path.join(out, n)).href;
  const shots = {
    "x-profile-desktop.png": [600, 330, `<div style="position:relative;width:600px;height:330px;background:#fff;font-family:system-ui">
      <img src="${a("zenod-banner-x-1500x500.png")}" style="width:600px;height:200px;display:block">
      <img src="${a("zenod-avatar-x-400.png")}" style="position:absolute;left:16px;top:133px;width:134px;height:134px;border-radius:50%;border:4px solid #fff">
      <div style="position:absolute;left:16px;top:276px;font-weight:700;font-size:20px">Zenod</div><div style="position:absolute;left:16px;top:302px;color:#536471;font-size:15px">@ZenodMemory</div></div>`],
    "x-profile-phone.png": [390, 230, `<div style="position:relative;width:390px;height:230px;background:#fff;font-family:system-ui;overflow:hidden">
      <div style="width:390px;height:120px;overflow:hidden"><img src="${a("zenod-banner-x-1500x500.png")}" style="width:390px;height:130px;margin-top:-5px;display:block"></div>
      <img src="${a("zenod-avatar-x-400.png")}" style="position:absolute;left:12px;top:92px;width:72px;height:72px;border-radius:50%;border:3px solid #fff">
      <div style="position:absolute;left:12px;top:174px;font-weight:700;font-size:18px">Zenod</div><div style="position:absolute;left:12px;top:198px;color:#536471;font-size:14px">@ZenodMemory</div></div>`],
    "youtube-desktop.png": [1284, 208, `<div style="width:1284px;height:208px;overflow:hidden;border-radius:12px"><img src="${a("zenod-banner-youtube-2560x1440.png")}" style="width:1284px;margin-top:-257px;display:block"></div>`],
    "youtube-phone.png": [390, 107, `<div style="width:390px;height:107px;overflow:hidden;border-radius:8px"><img src="${a("zenod-banner-youtube-2560x1440.png")}" style="width:646px;margin:-128px 0 0 -128px;display:block"></div>`],
    "linkedin-page.png": [1128, 300, `<div style="position:relative;width:1128px;height:300px;background:#fff;font-family:system-ui">
      <img src="${a("zenod-banner-linkedin-1128x191.png")}" style="width:1128px;height:191px;display:block">
      <img src="${a("zenod-avatar-linkedin-400.png")}" style="position:absolute;left:24px;top:127px;width:128px;height:128px;border:4px solid #fff">
      <div style="position:absolute;left:170px;top:205px;font-weight:600;font-size:24px">Zenod</div></div>`],
    "avatars-round.png": [520, 150, `<div style="display:flex;gap:28px;align-items:center;padding:18px;background:#fff;height:150px;font-family:system-ui">
      ${[110, 64, 40, 32, 24].map((s) => `<img src="${a("zenod-avatar-1024.png")}" style="width:${s}px;height:${s}px;border-radius:50%;box-shadow:0 0 0 1px #ddd">`).join("")}
      <img src="${a("zenod-avatar-1024.png")}" style="width:64px;height:64px;border-radius:14px;box-shadow:0 0 0 1px #ddd"></div>`],
  };
  for (const [name, [w, h, html]] of Object.entries(shots)) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(home);
    await page.setContent(`<style>*{margin:0;box-sizing:border-box}</style>${html}`);
    await page.waitForLoadState("load");
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(evidence, name), clip: { x: 0, y: 0, width: w, height: h } });
  }
}
await browser.close();
console.log("done", out);
