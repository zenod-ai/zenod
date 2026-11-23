// EPIC-21 V9 evidence shots: production's own page and bundle in headless Chromium, every /api/* call answered with
// TEST notes (no real person's text, root L-20). Same method as E12-S40 and E14-S47.
//   node docs/evidence/v9/shoot.mjs <base url> <out dir>      (needs playwright-core and sharp, e.g. from the repo's node_modules)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "https://cloud.zenod.dev/";
const out = process.argv[3] ?? ".";
mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;

const now = Date.parse('2026-11-23T10:00:00Z')
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


const TEAM = "From EpicTeam Chat", CARD = "From an EpicTeam card answer", DIRECT = "Spoken to Zenod";
mocks["/api/console/recent-saves"] = { saves: [
  { id: "a1", savedAt: iso(8), channel: "connector", kind: "voice", channelLabel: TEAM, label: TEAM, snippet: "Test note: the demo shed order is cedar boards, due Friday.", status: "saved", reply: "Saved.", notePath: "Log/2026-11-23.md#^e-test1", noteUrl: "" },
  { id: "a2", savedAt: iso(31), channel: "connector", kind: "voice", channelLabel: CARD, label: CARD, snippet: "Test note: answer to the demo card, yes, ship the label.", status: "saved", reply: "Saved.", notePath: "Log/2026-11-23.md#^e-test2", noteUrl: "" },
  { id: "a3", savedAt: iso(55), channel: "whatsapp", kind: "voice", channelLabel: DIRECT, label: DIRECT, snippet: "Test note: remind me to check the demo boiler sticker.", status: "saved", reply: "Saved.", notePath: "Log/2026-11-23.md#^e-test3", noteUrl: "" },
] };
mocks["/api/console/memory-glance"] = { status: "ready", totals: { memories: 3, voiceNotes: 3, pages: 1, places: 1, thisWeek: 3 },
  weeks: [{ week: "2026-11-16", kept: 0 }, { week: "2026-11-23", kept: 3 }], places: [{ title: "Home", path: null, pages: 1, latest: "2026-11-23" }],
  sources: [{ source: "mcp", label: "AI assistant", count: 2 }, { source: "whatsapp", label: "WhatsApp", count: 1 }] };
const gnode = (path, title, relation, extra = {}) => ({ path, title, summary: "", treePath: "", kind: "page", relation, links: 0, backlinks: 0, children: 0, degree: 1, hidden: 0, ...extra });
mocks["/api/console/memory-graph"] = { status: "ready", center: "Tree.md", nodes: [gnode("Tree.md", "Your memory", "center", { kind: "tree", degree: 1 }), gnode("Areas/Home.md", "Home", "child", { kind: "root", treePath: "Working memory \u203a Home" })],
  edges: [{ from: "Tree.md", to: "Areas/Home.md", kind: "tree" }], more: { parent: 0, child: 0, link: 0, backlink: 0 }, total: { nodes: 2, edges: 1 } };
const notes = {
  "Log/2026-11-23.md#^e-test1": { title: "Test note the demo shed order is cedar boards", label: TEAM, body: "Voice note ingested through Zenod media seam.\nSource: EpicTeam Chat voice note\nSource app: EpicTeam Chat\n\nTest note: the demo shed order is cedar boards, due Friday." },
  "Log/2026-11-23.md#^e-test3": { title: "Test note remind me to check the demo boiler sticker", label: DIRECT, body: "Voice note ingested through Zenod media seam.\nSource: WhatsApp voice note\n\nTest note: remind me to check the demo boiler sticker." },
};
mocks["/api/console/memory-search"] = { query: "test", tier: "index", ms: 3, results: [
  { rank: 1, path: "Log/2026-11-23.md#^e-test1", title: "Test note the demo shed order is cedar boards", snippet: "cedar boards", matchPercent: 100, treePath: "", kind: "log", label: TEAM },
  { rank: 2, path: "Log/2026-11-23.md#^e-test3", title: "Test note remind me to check the demo boiler sticker", snippet: "boiler", matchPercent: 62, treePath: "", kind: "log", label: DIRECT },
  { rank: 3, path: "Areas/Home.md", title: "Home", snippet: "demo home page", matchPercent: 40, treePath: "Working memory \u203a Home", kind: "page", label: null },
] };

const browser = await chromium.launch({ executablePath: chrome });
async function open(width, height, hash) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  if (base.startsWith("http://")) {
    // Staging answers plain http but its page asks for https subresources: fetch them over http.
    const host = new URL(base).host;
    await page.route(`https://${host}/**`, async (route) => {
      const url = route.request().url().replace("https://", "http://");
      const res = await fetch(url);
      return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    });
  }
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/console/memory-note") {
      const note = notes[url.searchParams.get("path")];
      return note ? route.fulfill({ json: { path: "Log/2026-11-23.md", url: "", provider: "github", ...note } }) : route.fulfill({ status: 404, json: {} });
    }
    const hit = mocks[url.pathname];
    return hit ? route.fulfill({ json: hit }) : route.fulfill({ status: 404, json: {} });
  });
  await page.goto(base + (hash ?? ""));
  await page.waitForTimeout(2500);
  return page;
}
for (const [name, width, height] of [["390", 390, 900], ["1280", 1280, 900]]) {
  let page = await open(width, height, "#glance");
  const card = page.locator('[data-testid="recent-saves-card"]');
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: join(out, `list-${name}.png`) });
  await page.close();
  page = await open(width, height, `#memory?path=${encodeURIComponent("Log/2026-11-23.md#^e-test1")}`);
  await page.waitForSelector('[data-testid="note-label"]', { timeout: 15000 });
  await page.locator(".zp-note").screenshot({ path: join(out, `note-${name}.png`) });
  await page.close();
  page = await open(width, height, "#graph");
  await page.getByPlaceholder("Find a memory\u2026").fill("test");
  const results = page.getByRole("list", { name: "Matching memories" });
  await results.waitFor({ timeout: 15000 });
  await results.screenshot({ path: join(out, `search-${name}.png`) });
  await page.close();
}
await browser.close();
