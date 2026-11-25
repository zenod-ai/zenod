import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./src/App";
import { VISION_CHAPTERS } from "./src/components/vision-page";

afterEach(() => vi.unstubAllGlobals());

function render(pathname: string) {
  vi.stubGlobal("window", { location: { pathname } });
  return renderToStaticMarkup(createElement(App)).replace(/\s+/g, " ");
}

const words = (text: string) => text.trim().split(/\s+/).length;

describe("Vision tab (E25-S5)", () => {
  it("is in the landing's nav and footer", () => {
    const home = render("/");
    expect(home).toContain('href="/vision"');
    expect(home).toContain(">Vision<");
  });

  it("tells 5 to 8 mini chapters, each a picture, a headline, a subtitle and a takeaway", () => {
    expect(VISION_CHAPTERS.length).toBeGreaterThanOrEqual(5);
    expect(VISION_CHAPTERS.length).toBeLessThanOrEqual(8);
    const html = render("/vision");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    for (const chapter of VISION_CHAPTERS) {
      const start = html.indexOf(`id="${chapter.id}"`);
      expect(start, chapter.id).toBeGreaterThan(-1);
      const section = html.slice(start, html.indexOf("</section>", start));
      expect(section).toContain('class="vz-pic scene"');
      expect(section).toContain(chapter.headline.replace(/’/g, "’"));
      expect(section).toContain('class="vz-sub"');
      expect(section).toContain('class="vz-take"');
      // Calm, one idea per screen: short beats.
      expect(words(chapter.headline), chapter.id).toBeLessThanOrEqual(10);
      expect(words(chapter.subtitle), chapter.id).toBeLessThanOrEqual(32);
      expect(words(chapter.takeaway), chapter.id).toBeLessThanOrEqual(14);
    }
  });

  it("tells owning your memory and context compounding, and marks every chapter why, live or vision", () => {
    const html = render("/vision");
    expect(html).toContain("Context compounds.");
    expect(html).toMatch(/belong to you/);
    for (const chapter of VISION_CHAPTERS) expect(["why", "live", "vision"]).toContain(chapter.kind);
    expect(VISION_CHAPTERS.filter((c) => c.kind === "vision").length).toBeGreaterThan(0);
    // Nothing invented about customers or numbers.
    const said = VISION_CHAPTERS.map((c) => `${c.headline} ${c.subtitle} ${c.takeaway}`).join(" ");
    expect(said).not.toMatch(/\bcustomers?\b|\busers love\b|\d+%|\d+,\d{3}/i);
  });

  it("has its own page title and description for links", () => {
    const doc = readFileSync(new URL("./vision.html", import.meta.url), "utf8");
    expect(doc).toContain("<title>Why Zenod exists");
    expect(doc).toContain('href="https://zenod.dev/vision"');
  });
});
