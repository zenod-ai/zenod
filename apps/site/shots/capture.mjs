// Renders the landing's product screenshots (ZAL-A9) into src/assets/shots/.
// Run from the repo root after `npm ci`, with playwright-core resolvable and a
// Chromium binary (CHROME=/path/to/chrome):
//   node apps/site/shots/capture.mjs            # the HTML shots in this folder
//   WEB_URL=http://127.0.0.1:5391/ node apps/site/shots/capture.mjs console
// The console shot is the real apps/web build (`npx vite` in apps/web) with
// every /api/* call answered by the demo data below. Demo content only.
import { chromium } from "playwright-core";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../src/assets/shots");
const chrome = process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;

const now = Date.parse('2026-11-04T09:40:00Z')
const iso = (m) => new Date(now - m * 60000).toISOString()
const mocks = {
  '/api/auth/status': { needsSetup: false, configured: true, hostedMode: null, customerAuth: true, authMethod: 'google', signInMethods: ['google', 'github'] },
  '/api/me': { provider: 'google', providers: ['google'] },
  '/api/console/account': { account_id: 'account-1' },
  '/api/vault/provider': { ready: true, provider: process.env.VP || 'github', memory: { store: true, search: true, get: true, ask: true, attachments: true }, githubTasking: false, blocker: null },
  '/api/vault': { repo: 'maya-demo/memory', branch: 'main', vaultConfigured: true, configured: true, provider: 'openrouter', llmReady: true, cloned: true, headSha: '3f9c2a1', cloneError: null },
  '/api/settings': { settings: { provider: 'openrouter' } },
  '/api/overview': { unit: { name: 'zenod' }, tenant: { id: 'tenant-1', name: "Maya's memory" }, usage: null },
  '/api/mcp-config': { tenant: { id: 'tenant-1', name: "Maya's memory", plan: 'hosted' }, unit: { name: 'zenod', version: '1' }, endpoint: 'https://cloud.zenod.dev/mcp', tokenedEndpoint: 'https://cloud.zenod.dev/mcp', auth: { bearer: true, tokenedUrl: false, oauth: true }, routes: [] },
  '/api/account/mcp-tokens': { tokens: [ { id: 't1', label: 'Claude Code', preview: 'zt_••••7Q2c', created_at: now - 6*86400000, last_used_at: now - 95*60000, revoked_at: null }, { id: 't2', label: 'Cursor', preview: 'zt_••••b81F', created_at: now - 20*86400000, last_used_at: now - 2*86400000, revoked_at: null } ] },
  '/api/connections': { token: 'zt_demo_0000000000000000', mcpPath: '/mcp', clients: [ { name: 'claude-code', version: '2.1', lastSeen: now - 95*60000, connections: 14 } ], grants: [ { clientName: 'Claude Code', clientId: 'c1', createdAt: now - 6*86400000, expiresAt: now + 24*86400000 } ] },
  '/api/drive/status': { configured: true, oauthAvailable: true, oauthClientConfigured: true, accountEmail: 'maya@example.com', folderId: 'demo', archiveConfigured: true, archiveReason: null },
  '/api/subscribers': { subscribers: [] },
  '/api/customer-usage': { percentageUsed: 18, state: 'normal', resetsAt: '2026-12-01T00:00:00Z', breakdown: { ai: { spendUsd: null, allowanceUsd: null, percentageUsed: 18, paused: false }, channel: { usedUnits: 42, allowanceUnits: 400, percentageUsed: 11, paused: false } } },
  '/api/console/recent-saves': { saves: [
    { id: 's1', savedAt: iso(12), channel: 'whatsapp', kind: 'voice', channelLabel: 'WhatsApp voice', snippet: 'Just talked to Leo about the shed. He can come Saturday morning to help put up the frame, so I need to order the cedar boards before Friday.', status: 'saved', reply: 'Saved.', notePath: 'Projects/Garden shed.md', noteUrl: 'https://github.com/maya-demo/memory/blob/main/Projects/Garden%20shed.md' },
    { id: 's2', savedAt: iso(95), channel: 'connector', kind: 'text', channelLabel: 'AI assistant', snippet: 'When migrating the orders table, run it on a copy first: the live table locks for several minutes.', status: 'saved', reply: 'Saved.', notePath: 'Notes/Database migrations.md', noteUrl: 'https://github.com/maya-demo/memory/blob/main/Notes/Database migrations.md' },
    { id: 's3', savedAt: iso(300), channel: 'whatsapp', kind: 'image', channelLabel: 'WhatsApp image', snippet: 'Boiler service sticker: next service due March 2027.', status: 'saved', reply: 'Saved.', notePath: 'Areas/Home.md', noteUrl: 'https://github.com/maya-demo/memory/blob/main/Areas/Home.md' },
  ] },
  '/api/channels': { whatsapp: { state: 'verified', senderHint: '••••4821', sharedNumber: '+00 000 000 000', verificationExpiresAt: null, lastInboundAt: now - 12 * 60000, lastReceiptAt: now - 11 * 60000, revision: 'wa-1' }, telegram: { state: 'off', identityHint: null, verificationExpiresAt: null, revision: 'tg-1' } },
}

// [name, scale, phone-width variant in CSS px (0 = none)]. The phone variant
// reflows the same screen at a narrow width so its text stays readable at 390 px.
const HTML_SHOTS = [
  ["whatsapp", 3, 0],
  ["log", 2, 380],
  ["page", 2, 380],
  ["learn", 2, 380],
  ["recall", 2, 380],
  ["history", 2, 380],
];

async function save(png, name) {
  await sharp(png).webp({ quality: 86 }).toFile(join(out, `${name}.webp`));
  const meta = await sharp(png).metadata();
  console.log(`${name}.webp ${meta.width}x${meta.height}`);
}

const browser = await chromium.launch({ executablePath: chrome });
const only = process.argv.slice(2);
for (const [name, scale, narrow] of HTML_SHOTS) {
  if (only.length && !only.includes(name)) continue;
  for (const width of narrow ? [0, narrow] : [0]) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: scale });
    await page.goto(`file://${join(here, `${name}.html`)}`);
    if (width)
      await page.evaluate((w) => {
        document.body.classList.add("narrow");
        document.getElementById("shot").style.width = `${w}px`;
      }, width);
    await page.evaluate(() => document.fonts.ready);
    await save(await page.locator("#shot").screenshot(), width ? `${name}-phone` : name);
    await page.close();
  }
}
async function openConsole(width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  await page.clock.install({ time: now });
  await page.route("**/api/**", (route) => {
    const key = new URL(route.request().url()).pathname;
    return mocks[key] ? route.fulfill({ json: mocks[key] }) : route.fulfill({ status: 404, json: {} });
  });
  await page.goto(process.env.WEB_URL ?? "http://127.0.0.1:5391/");
  await page.clock.runFor(3000);
  await page.waitForTimeout(1500);
  return page;
}
if (only.includes("console")) {
  // Desktop: a 780 px console so its text stays readable at the size the landing shows it.
  let page = await openConsole(780);
  // From the page title down (the tab strip scrolls sideways at this width).
  const head = (await page.getByText("Hosted customer", { exact: true }).first().boundingBox()).y - 22;
  let bottom = await page.getByText("Areas/Home.md", { exact: true }).first().boundingBox();
  await save(await page.screenshot({ fullPage: true, clip: { x: 0, y: head, width: 780, height: Math.ceil(bottom.y + bottom.height + 40 - head) } }), "console");
  await page.close();
  // Phone: the console's own narrow layout, from the usage card to the last save.
  page = await openConsole(390);
  const top = (await page.locator('[data-testid="hosted-usage-card"]').boundingBox()).y;
  bottom = await page.getByText("Areas/Home.md", { exact: true }).first().boundingBox();
  await save(await page.screenshot({ fullPage: true, clip: { x: 0, y: top - 14, width: 390, height: Math.ceil(bottom.y + bottom.height + 30 - top + 14) } }), "console-phone");
  await page.close();
}
await browser.close();
