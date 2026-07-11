import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it } from "vitest";
import { PHYLAX_AGENT } from "../src/agent.js";
import { createPhylaxUnit } from "../src/phylaxUnit.js";
import { resolveServerMode } from "../src/serverMode.js";

const dirs: string[] = [];
const MASTER_KEY = "22".repeat(32);

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Phylax customer unit mount", () => {
  it("selects Phylax mode explicitly", () => {
    expect(resolveServerMode({ ZENOD_UNIT: "phylax" }, PHYLAX_AGENT.name)).toBe("phylax");
  });

  it("serves the Phylax landing and customer dashboard shell on the canonical host", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-static-"));
    dirs.push(dataDir);
    const siteDist = join(dataDir, "site");
    const webDist = join(dataDir, "web");
    await mkdir(siteDist);
    await mkdir(webDist);
    await writeFile(join(siteDist, "index.html"), "PHYLAX LANDING");
    await writeFile(join(webDist, "index.html"), "PHYLAX APP");
    const unit = createPhylaxUnit({
      dataDir: join(dataDir, "data"),
      siteDist,
      webDist,
      tenantStore: createMemoryTenantStore(),
      env: { CHASSIS_VAULT_MASTER_KEY: MASTER_KEY },
    });
    try {
      expect(await (await unit.app.request("/", { headers: { host: "phylax.zenod.dev" } })).text())
        .toContain("PHYLAX LANDING");
      expect(await (await unit.app.request("/app", { headers: { host: "phylax.zenod.dev" } })).text())
        .toContain("PHYLAX APP");
    } finally {
      unit.close();
    }
  });
});
