import { mkdirSync } from "node:fs";
import { accessSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { Runtime } from "./runtime.js";

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

const runtime = new Runtime(dataDir);
const app = createApp(runtime, hasWeb ? { webDist } : {});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`zenod server listening on :${info.port} (data: ${dataDir}${hasWeb ? `, ui: ${webDist}` : ", no ui build"})`);
});
