// E14-S26 local check: a transcription relay. The harness's OpenRouter calls come here; each one runs
// as a one-shot curl on VPS1 inside `secret run openrouter`, so the key never leaves VPS1 and is never
// printed. Only /audio/transcriptions is relayed, at most 12 calls. Localhost only.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
const PORT = Number(process.argv[2] ?? 18941);
let calls = 0;
createServer((req, res) => {
  if (req.method !== "POST" || !req.url.endsWith("/audio/transcriptions") || calls >= 12) { res.writeHead(403); return res.end("{}"); }
  calls += 1;
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const remote = `secret run openrouter -- sh -c 'curl -sS -m 120 -w "\\n%{http_code}" -X POST https://openrouter.ai/api/v1/audio/transcriptions -H "Authorization: Bearer $OPENROUTER_API_KEY" -H "Content-Type: application/json" --data-binary @-'`;
    const ssh = spawn("ssh", ["hetzner_vps_1", remote]);
    const out = [];
    ssh.stdout.on("data", (c) => out.push(c));
    ssh.stderr.on("data", () => {});
    ssh.on("close", () => {
      const text = Buffer.concat(out).toString();
      const cut = text.lastIndexOf("\n");
      const status = Number(text.slice(cut + 1)) || 502;
      console.log(`[relay] call ${calls}: HTTP ${status}, ${cut} bytes`);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(text.slice(0, cut));
    });
    ssh.stdin.end(Buffer.concat(chunks));
  });
}).listen(PORT, "127.0.0.1", () => console.log(`relay on ${PORT}`));
