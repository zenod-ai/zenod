import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROJECTS,
  loadProjectRegistry,
  projectRegistrySection,
  resolveProject,
  type ProjectEntry,
} from "../src/projectRegistry.js";

const registry: ProjectEntry[] = [
  { aliases: ["dioptra", "optra bot", "telegram bot"], repo: "AlfaBlok/idea_scraper", path: "ideascraper-vps-v1/telegram-bot" },
  { aliases: ["site"], repo: "zenod-ai/zenod" },
];

describe("resolveProject", () => {
  it("resolves an informal alias inside a free-text request to the right repo+path", () => {
    const p = resolveProject(registry, "please restyle the dioptra bot output");
    expect(p?.repo).toBe("AlfaBlok/idea_scraper");
    expect(p?.path).toBe("ideascraper-vps-v1/telegram-bot");
  });

  it("resolves by exact owner/repo and by bare repo name", () => {
    expect(resolveProject(registry, "AlfaBlok/idea_scraper")?.repo).toBe("AlfaBlok/idea_scraper");
    expect(resolveProject(registry, "idea_scraper")?.repo).toBe("AlfaBlok/idea_scraper");
  });

  it("prefers the longest matching alias when several could match", () => {
    // "telegram bot" (12) beats "site" non-match; the more specific phrase wins.
    expect(resolveProject(registry, "the telegram bot needs work")?.repo).toBe("AlfaBlok/idea_scraper");
  });

  it("returns null when nothing matches confidently (caller should ask, not guess)", () => {
    expect(resolveProject(registry, "the quarterly finances")).toBeNull();
    expect(resolveProject(registry, "")).toBeNull();
  });
});

describe("projectRegistrySection", () => {
  it("renders an instruction block that lists repos and tells the agent not to ask", () => {
    const section = projectRegistrySection(registry);
    expect(section).toContain("AlfaBlok/idea_scraper");
    expect(section).toContain("WITHOUT asking");
    expect(projectRegistrySection([])).toBe("");
  });
});

describe("loadProjectRegistry", () => {
  it("falls back to built-ins when no override file is set", () => {
    expect(loadProjectRegistry({})).toBe(DEFAULT_PROJECTS);
  });

  it("loads a valid JSON override and ignores a broken one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-projects-"));
    try {
      const good = join(dir, "good.json");
      await writeFile(good, JSON.stringify([{ aliases: ["x"], repo: "o/r" }]));
      expect(loadProjectRegistry({ ZENOD_PROJECTS_FILE: good })[0]?.repo).toBe("o/r");

      const bad = join(dir, "bad.json");
      await writeFile(bad, "{not json");
      expect(loadProjectRegistry({ ZENOD_PROJECTS_FILE: bad })).toBe(DEFAULT_PROJECTS);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ships a DIOPTRA entry so the documented test case resolves out of the box", () => {
    expect(resolveProject(DEFAULT_PROJECTS, "the dioptra bot")?.repo).toBe("AlfaBlok/idea_scraper");
  });
});
