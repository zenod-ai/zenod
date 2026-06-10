import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

const fixtureVault = fileURLToPath(new URL("./fixtures/vault/", import.meta.url));

describe("package", () => {
  it("exports a version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("fixture vault", () => {
  it("has the schema config", async () => {
    const config = await readFile(`${fixtureVault}.brain/config.yml`, "utf8");
    expect(config).toContain("schema_version: 1");
  });

  it("has an evidence entry with a block anchor", async () => {
    const log = await readFile(`${fixtureVault}Log/2026-06-10.md`, "utf8");
    expect(log).toMatch(/\^e-[0-9a-f]{6}/);
  });
});
