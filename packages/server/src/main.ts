import { mkdirSync } from "node:fs";
import { accessSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { Runtime } from "./runtime.js";
import { resolveAgent } from "./agent.js";

const port = Number(process.env.PORT ?? 8080);
const dataDir = resolve(process.env.ZENOD_DATA_DIR ?? "./data");
mkdirSync(dataDir, { recursive: true });

const webDist = process.env.ZENOD_WEB_DIST ?? resolve(import.meta.dirname, "../../../apps/web/dist");
let hasWeb = true;
try {
  accessSync(webDist);
} catch {
  hasWeb = false;
}

// One image can run as any agent — pick it from the AGENT env var (default zenod).
const agent = resolveAgent(process.env.AGENT);
const runtime = new Runtime(dataDir, agent);
const app = createApp(runtime, hasWeb ? { webDist } : {});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `${agent.name} server listening on :${info.port} (data: ${dataDir}${hasWeb ? `, ui: ${webDist}` : ", no ui build"})`,
  );
});
