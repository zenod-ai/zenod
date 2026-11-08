// Run from the repo root after `npm run build -w zenod`, with an OpenRouter key in the environment:
//   node scripts/e16-send-route-eval.mjs [model]   (default: the hosted chat model)
// E16-B1: score the one Send decision with the production chat model (OpenRouter), the same prompt and guard the app uses.
import { readFileSync } from "node:fs";
import { sendRoutePrompt, parseSendRoute, ruleSendRoute } from "../packages/core/dist/llm/sendRoute.js";
const key = process.env.ZENOD_PLATFORM_OPENROUTER_KEY || process.env.OPENROUTER_API_KEY;
if (!key) { console.log("no key"); process.exit(2); }
const model = process.argv[2] || "google/gemini-3.1-flash-lite";
const out = { model, sets: {} };
for (const file of ["packages/core/test/fixtures/send-route-40.json", "packages/core/test/fixtures/send-route-heldout-40.json"]) {
  const { messages } = JSON.parse(readFileSync(file, "utf8"));
  const rows = [];
  for (const m of messages) {
    const { system, prompt } = sendRoutePrompt(m.message);
    const t0 = Date.now();
    let raw = "";
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 300, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }) });
      const j = await r.json(); raw = j?.choices?.[0]?.message?.content ?? "";
    } catch { raw = ""; }
    const ms = Date.now() - t0;
    const parsed = parseSendRoute(raw, m.message);
    let rawAction = "slip";
    try { const v = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]); const k = (v.keep || "").trim(), a = (v.ask || "").trim(); rawAction = k && a ? "both" : k ? "keep" : "answer"; } catch {}
    const route = parsed ?? ruleSendRoute(m.message);
    rows.push({ message: m.message, expect: m.expect, got: route.action, by: parsed ? "model" : "rules", keep: route.keep, question: route.question, ms, ok: route.action === m.expect, rawAction, guardChanged: parsed ? rawAction !== route.action : false });
  }
  const right = rows.filter((r) => r.ok).length;
  const questionsKept = rows.filter((r) => r.expect === "answer" && r.keep).length;
  out.sets[file] = { right, total: rows.length, questionsKept, slips: rows.filter((r) => r.by === "rules").length, rawRight: rows.filter((r) => r.rawAction === r.expect).length, guardChanged: rows.filter((r) => r.guardChanged).length, medianMs: rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)], rows };
}
console.log(JSON.stringify(out));
