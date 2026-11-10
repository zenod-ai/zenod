import { accessSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createGracefulShutdown, shutdownTimings } from "./gracefulShutdown.js";
import { outlastProxyKeepAlive } from "./proxyKeepAlive.js";
import { compileAllToolOutputSchemas } from "./toolOutput.js";
import { createPhylaxUnit } from "./phylaxUnit.js";
import {
  assertDedicatedPhylaxProcessEnv,
  resolvePhylaxInstanceConfig,
} from "./phylaxInstance.js";

const env = process.env;
assertDedicatedPhylaxProcessEnv(env);
const instance = resolvePhylaxInstanceConfig(env);
const port = Number(env.PORT ?? 8080);
const dataDir = resolve(env.ZENOD_DATA_DIR ?? "./data");
const webDist = env.PHYLAX_WEB_DIST ?? resolve(import.meta.dirname, "../../../apps/phylax-web/dist");
const siteDist = env.PHYLAX_SITE_DIST ?? resolve(import.meta.dirname, "../../../apps/phylax-site/dist");
mkdirSync(dataDir, { recursive: true });

function available(path: string): string | undefined {
  try {
    accessSync(path);
    return path;
  } catch {
    return undefined;
  }
}

compileAllToolOutputSchemas();
const unit = createPhylaxUnit({
  dataDir,
  webDist: available(webDist),
  siteDist: available(siteDist),
  env,
  instance,
});
const server = serve({ fetch: unit.app.fetch, port }, (info) => {
  console.log(
    `phylax ${instance.mode} instance ${instance.instanceId} listening on :${info.port} (data: ${dataDir})`,
  );
});

outlastProxyKeepAlive(server);

const shutdown = createGracefulShutdown({
  server,
  closeResources: () => unit.close(),
  label: "phylax",
  ...shutdownTimings(process.env),
});

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
