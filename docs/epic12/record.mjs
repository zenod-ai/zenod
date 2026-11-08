// Usage: node record.mjs <url> <selector> <outdir> <ms> [w] [h]: frames of one scene (every ~120 ms) for a GIF.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const [url, sel, out, ms = '12000', w = '1440', h = '900'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const B = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const p = spawn(B, ['--no-sandbox', '--hide-scrollbars', '--remote-debugging-port=9334', `--window-size=${w},${h}`, 'about:blank']);
await new Promise(r => setTimeout(r, 1500));
const list = await (await fetch('http://127.0.0.1:9334/json')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = {};
ws.onmessage = m => { const d = JSON.parse(m.data); if (pend[d.id]) { pend[d.id](d.result); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise(r => { pend[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await new Promise(r => setTimeout(r, 3000));
await ev(`document.documentElement.style.scrollBehavior='auto';document.querySelector('${sel}').closest('.slide').scrollIntoView()`);
await new Promise(r => setTimeout(r, 400));
const box = await ev(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.x,y:Math.max(0,r.y)+scrollY,width:r.width,height:Math.min(r.height, ${h}-Math.max(0,r.y))}})()`);
const t0 = Date.now(); let n = 0;
while (Date.now() - t0 < +ms) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } });
  writeFileSync(`${out}/f${String(n++).padStart(4, '0')}.png`, Buffer.from(data, 'base64'));
  await new Promise(r => setTimeout(r, Math.max(0, n * 120 - (Date.now() - t0))));
}
console.log('frames', n, 'in', Date.now() - t0, 'ms');
ws.close(); p.kill();
