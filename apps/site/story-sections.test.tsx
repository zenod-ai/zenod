import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./src/App";
import { storyChapters, StorySections } from "./src/components/story-sections";

const page = readFileSync(new URL("./src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./src/index.css", import.meta.url), "utf8");
const hash = (content: string | Buffer) =>
  createHash("sha256").update(content).digest("hex");
afterEach(() => vi.unstubAllGlobals());

describe("storyboard landing integration", () => {
  it("preserves the exact original hero and original CSS from base 99f9f22", () => {
    const start = page.indexOf('        <section className="v5-hero">');
    const end =
      page.indexOf("        </section>", start) + "        </section>".length;
    expect(hash(page.slice(start, end))).toBe(
      "a3f696eedd3777e832ba83b4e516fbbbfd39be2a7ed67fcdf53d12031993b8b0",
    );
    const originalCss = css.slice(0, css.indexOf("/* ZLS story:")).trimEnd();
    expect(hash(originalCss)).toBe(
      "31df260d8caf86a2627a8d79f111897095cf8b51283c441da9943b659190800c",
    );
    expect(
      hash(
        readFileSync(
          new URL("./src/assets/zenod-v5-hero-librarian.webp", import.meta.url),
        ),
      ),
    ).toBe("41cb12486bb102ace4c36d5585893578a9ffc351b527850735725a67f9babe57");
  });

  it("renders every board chapter with live headings below the hero, without legacy sections", () => {
    vi.stubGlobal("window", { location: { pathname: "/" } });
    const html = renderToStaticMarkup(createElement(App));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.match(/class="zls-chapter"/g)).toHaveLength(10);
    expect(html.match(/<h2\b/g)).toHaveLength(10);
    expect(html.indexOf('class="v5-hero"')).toBeLessThan(
      html.indexOf('class="zls-story"'),
    );
    for (const legacy of [
      "v5-context-stack",
      "v5-input-grid",
      "v5-faq-list",
      "v5-final",
      "v5-freedom",
    ]) {
      expect(html).not.toContain(legacy);
    }
    expect(html).toContain("€9/month + VAT");
    expect(html).not.toContain("$3");
    expect(html).toContain("Hosted beta opening soon");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it("keeps Alexandria before the offer and uses every storyboard exactly once", () => {
    expect(storyChapters.map((chapter) => chapter.source)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "09",
      "08",
      "10",
    ]);
    expect(new Set(storyChapters.map((chapter) => chapter.id)).size).toBe(10);
  });

  it("makes all diagram assets responsive, lazy-loaded, accessible and available at full size", () => {
    const html = renderToStaticMarkup(
      createElement(StorySections, { pricing: null }),
    );
    expect(html.match(/loading="lazy"/g)).toHaveLength(10);
    expect(html.match(/srcSet="/g)).toHaveLength(10);
    expect(html.match(/width="1774" height="887"/g)).toHaveLength(10);
    for (const chapter of storyChapters) {
      expect(chapter.alt.length).toBeGreaterThan(70);
      expect(html).toContain('id="' + chapter.id + '-title"');
      expect(chapter.image).toMatch(/\.webp/);
      expect(chapter.small).toMatch(/-small\.webp/);
    }
    const assetDir = new URL("./src/assets/story/", import.meta.url);
    const files = readdirSync(assetDir);
    expect(files.filter((file) => file.endsWith(".webp"))).toHaveLength(20);
    expect(
      files.reduce(
        (sum, file) => sum + statSync(new URL(file, assetDir)).size,
        0,
      ),
    ).toBeLessThan(1_600_000);
  });

  it("keeps local anchor destinations unique and pricing on its original route", () => {
    vi.stubGlobal("window", { location: { pathname: "/" } });
    const html = renderToStaticMarkup(createElement(App));
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const match of html.matchAll(/href="\/?#([^"]+)"/g))
      expect(ids).toContain(match[1]);
    expect(html).toContain('href="/pricing"');
    vi.stubGlobal("window", { location: { pathname: "/pricing" } });
    const pricing = renderToStaticMarkup(createElement(App));
    expect(pricing).toContain("Zenod plans");
    expect(pricing).toContain("€9/month + VAT");
    expect(pricing).not.toContain('class="zls-story"');
  });
});
