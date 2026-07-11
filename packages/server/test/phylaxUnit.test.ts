import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it } from "vitest";
import { PHYLAX_AGENT } from "../src/agent.js";
import { createPhylaxUnit } from "../src/phylaxUnit.js";
import { resolveServerMode } from "../src/serverMode.js";
import { issueCustomerSession } from "../src/customerSession.js";
import { Hono } from "hono";

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

  it("returns 404 for /admin and its channel APIs unless the GitHub session login is exactly alfablok", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-admin-"));
    dirs.push(dataDir);
    const webDist = join(dataDir, "web");
    await mkdir(webDist);
    await writeFile(join(webDist, "index.html"), "PHYLAX ADMIN");
    const env = { ACCOUNT_STATE_SECRET: "admin-test-secret", CHASSIS_VAULT_MASTER_KEY: MASTER_KEY };
    const unit = createPhylaxUnit({
      dataDir: join(dataDir, "data"),
      webDist,
      tenantStore: createMemoryTenantStore(),
      env,
    });
    const cookieFor = async (login: string) => {
      const sessions = new Hono();
      sessions.get("/", (c) => {
        issueCustomerSession(c, { id: login === "alfablok" ? 1 : 2, login }, env);
        return c.text("ok");
      });
      return (await sessions.request("/")).headers.get("set-cookie")!.split(";", 1)[0]!;
    };
    try {
      expect((await unit.app.request("/admin")).status).toBe(404);
      expect((await unit.app.request("/admin", { headers: { cookie: await cookieFor("someone-else") } })).status).toBe(404);
      expect((await unit.app.request("/api/whatsapp/status", { headers: { cookie: await cookieFor("someone-else") } })).status).toBe(404);
      const adminCookie = await cookieFor("alfablok");
      const page = await unit.app.request("/admin", { headers: { cookie: adminCookie } });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("PHYLAX ADMIN");
      const status = await unit.app.request("/api/whatsapp/status", { headers: { cookie: adminCookie } });
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ state: "disabled", linkedNumber: null });
    } finally {
      unit.close();
    }
  });
});
