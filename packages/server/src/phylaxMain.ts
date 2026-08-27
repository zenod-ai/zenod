import { accessSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
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

let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  const serverClosed = new Promise<void>((done, reject) => {
    server.close((error?: Error) => error ? reject(error) : done());
  });
  if ("closeIdleConnections" in server && typeof server.closeIdleConnections === "function") {
    server.closeIdleConnections();
  }
  const resourcesClosed = Promise.resolve(unit.close());
  const forceTimer = setTimeout(() => {
    console.error("phylax shutdown exceeded 10 seconds; closing remaining HTTP connections");
    process.exitCode = 1;
    if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
  }, 10_000);
  void Promise.allSettled([serverClosed, resourcesClosed]).then((results) => {
    clearTimeout(forceTimer);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) {
      console.error("phylax shutdown failed:", new AggregateError(failures, "Phylax shutdown failed"));
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
