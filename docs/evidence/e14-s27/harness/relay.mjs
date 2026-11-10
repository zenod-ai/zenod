// E14-S27 local check: a model relay. The harness's OpenRouter chat calls come here; each one runs as a
// one-shot curl on VPS1 inside `secret run openrouter`, so the key never leaves VPS1 and is never
// printed. Thinking is switched off on each call. Only /chat/completions is relayed, at most 60 calls. Localhost only. Logs status and size.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
const PORT = Number(process.argv[2] ?? 18951);
let calls = 0;
createServer((req, res) => {
  if (req.method !== "POST" || !req.url.endsWith("/chat/completions") || calls >= 60) { res.writeHead(403); return res.end("{}"); }
  calls += 1;
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    // Thinking off, as production's DeepSeek route sends it (S5, #1562): OpenRouter takes it as `reasoning`.
    const json = JSON.parse(Buffer.concat(chunks).toString());
    json.reasoning = { enabled: false };
    const body = Buffer.from(JSON.stringify(json));
    const stream = /"stream"\s*:\s*true/.test(body.toString());
    const remote = `secret run openrouter -- sh -c 'curl -sS -m 180 -w "\\n%{http_code}" -X POST https://openrouter.ai/api/v1/chat/completions -H "Authorization: Bearer $OPENROUTER_API_KEY" -H "Content-Type: application/json" --data-binary @-'`;
    const ssh = spawn("ssh", ["hetzner_vps_1", remote]);
    const out = [];
    ssh.stdout.on("data", (c) => out.push(c));
    ssh.stderr.on("data", () => {});
    ssh.on("close", () => {
      const text = Buffer.concat(out).toString();
      const cut = text.lastIndexOf("\n");
      const status = Number(text.slice(cut + 1)) || 502;
      console.log(`[relay] call ${calls}: HTTP ${status}, ${cut} bytes${stream ? ", stream" : ""}`);
      res.writeHead(status, { "content-type": stream ? "text/event-stream" : "application/json" });
      res.end(text.slice(0, cut));
    });
    ssh.stdin.end(body);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`relay on ${PORT}`));
