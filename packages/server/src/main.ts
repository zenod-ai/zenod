import { mkdirSync } from "node:fs";
import { accessSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { Runtime } from "./runtime.js";
import { resolveAgent } from "./agent.js";
import { compileAllToolOutputSchemas } from "./toolOutput.js";
import { createZenodUnit } from "./zenodUnit.js";

const port = Number(process.env.PORT ?? 8080);
const dataDir = resolve(process.env.ZENOD_DATA_DIR ?? "./data");
mkdirSync(dataDir, { recursive: true });

const webDist = process.env.ZENOD_WEB_DIST ?? resolve(import.meta.dirname, "../../../apps/web/dist");
const siteDist = process.env.ZENOD_SITE_DIST ?? resolve(import.meta.dirname, "../../../apps/site/dist");
let hasWeb = true;
let hasSite = true;
try {
  accessSync(webDist);
} catch {
  hasWeb = false;
}
try {
  accessSync(siteDist);
} catch {
  hasSite = false;
}

// One image can run as any agent — pick it from the AGENT env var (default zenod).
const agent = resolveAgent(process.env.AGENT);
compileAllToolOutputSchemas();
const useChassisZenod = !process.env.AGENT || agent.name === "zenod";
const unit = useChassisZenod
  ? createZenodUnit({
      dataDir,
      ...(hasWeb ? { webDist } : {}),
      env: process.env,
    })
  : null;
const runtime = unit ? null : new Runtime(dataDir, agent);
const app =
  unit?.app ??
  createApp(runtime!, {
    ...(hasWeb ? { webDist } : {}),
    ...(hasSite ? { siteDist } : {}),
  });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `${agent.name} ${unit ? "chassis unit" : "server"} listening on :${info.port} (data: ${dataDir}${hasWeb ? `, dashboard: ${webDist}` : ", no dashboard build"}${hasSite ? `, site: ${siteDist}` : ", no site build"})`,
  );
});

let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  server.close(() => {
    unit?.close();
    runtime?.close();
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
