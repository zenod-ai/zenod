const { chromium } = require('/tmp/s8/pw/node_modules/playwright');
(async () => {
  const b = await chromium.launch();
  const url = 'http://vps3.taild81fbb.ts.net:8921/e14-s10-tiers/?still';
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(url); await p.waitForTimeout(800);
  const ids = await p.$$eval('section.slide', s => s.map(x => x.id));
  for (const id of ids) { const el = await p.$('#' + id); await el.screenshot({ path: `/tmp/s10shots/d-${id}.png` }); }
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(url); await m.waitForTimeout(800);
  await m.screenshot({ path: '/tmp/s10shots/phone-full.png', fullPage: true });
  const over = await m.evaluate(() => document.documentElement.scrollWidth);
  console.log(ids.join(','), 'phone scrollWidth', over);
  await b.close();
})();
