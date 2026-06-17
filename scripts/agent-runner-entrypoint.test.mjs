import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("agent runner entrypoint registers the Console MCP gateway for Codex", () => {
  const root = mkdtempSync(join(tmpdir(), "zenod-runner-entrypoint-"));
  const codexHome = join(root, "codex-home");
  const home = join(root, "home");
  try {
    const result = spawnSync("bash", [join(process.cwd(), "scripts/agent-runner-entrypoint.sh"), "true"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        HOME: home,
        ZENOD_CONSOLE_URL: "http://console.internal:8080",
        ZENOD_CONSOLE_TOKEN: "console-token",
        X_MCP_READONLY_URL: "http://x-readonly.internal:8000/mcp",
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const config = readFileSync(join(codexHome, "config.toml"), "utf8");
    assert.match(config, /\[mcp_servers\.console\]/);
    assert.match(config, /url = "http:\/\/console\.internal:8080\/mcp"/);
    assert.match(config, /bearer_token_env_var = "ZENOD_CONSOLE_TOKEN"/);
    assert.doesNotMatch(config, /\[mcp_servers\.zenod\]/);
    assert.doesNotMatch(config, /ZENOD_API_TOKEN/);
    assert.match(config, /\[mcp_servers\.x\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
