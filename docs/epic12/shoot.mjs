// Usage: node shoot.mjs <url> <outdir> <width> <height>
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [url, out, w = '1440', h = '900'] = process.argv.slice(2);
const B = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const p = spawn(B, ['--no-sandbox', '--hide-scrollbars', '--remote-debugging-port=9333', `--window-size=${w},${h}`, 'about:blank']);
await new Promise(r => setTimeout(r, 1500));
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = {};
ws.onmessage = m => { const d = JSON.parse(m.data); if (pend[d.id]) { pend[d.id](d.result); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise(r => { pend[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await new Promise(r => setTimeout(r, 3500));
const n = (await send('Runtime.evaluate', { expression: 'document.querySelectorAll(".slide").length', returnByValue: true })).result.value;
for (let i = 0; i < n; i++) {
  await send('Runtime.evaluate', { expression: `document.documentElement.style.scrollBehavior='auto';document.querySelectorAll('.slide')[${i}].scrollIntoView()` });
  await new Promise(r => setTimeout(r, 2800));
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/slide-${String(i + 1).padStart(2, '0')}.png`, Buffer.from(data, 'base64'));
}
ws.close(); p.kill();
console.log('shots', n);
