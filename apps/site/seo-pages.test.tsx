// E7-S42: zenod.dev says Zenod Memory, ships real HTML, and answers what people search for.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "./src/App";

const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const PAGES = JSON.parse(read("scripts/pages.json")) as Record<string, string>;
const tag = (html: string, re: RegExp) => html.match(re)?.[1] ?? "";

describe("zenod.dev pages for Google (E7-S42)", () => {
  it("gives every page a title that says Zenod Memory, its own canonical and a description Google shows whole", () => {
    for (const [file, path] of Object.entries(PAGES)) {
      const html = read(file);
      expect(tag(html, /<title>([^<]*)<\/title>/), file).toContain("Zenod Memory");
      if (path === "/404") continue;
      const canonical = path === "/" ? "https://zenod.dev/" : `https://zenod.dev${path}`;
      expect(html, file).toContain(`<link rel="canonical" href="${canonical}" />`);
      const description = tag(html, /<meta\s+name="description"\s+content="([^"]*)"/);
      expect(description.length, file).toBeGreaterThan(50);
      expect(description.length, file).toBeLessThanOrEqual(155);
    }
  });

  it("prerenders each page to HTML with an h1 that names Zenod", () => {
    for (const path of Object.values(PAGES)) {
      const html = renderToString(createElement(App, { path }));
      const h1 = tag(html, /<h1[^>]*>([\s\S]*?)<\/h1>/).replace(/<[^>]+>/g, "");
      if (path === "/404" || path === "/vision") continue;
      expect(h1, path).toMatch(/Zenod/);
    }
  });

  it("lists every page in the sitemap, /pricing included", () => {
    const sitemap = read("public/sitemap.xml");
    for (const path of Object.values(PAGES)) {
      if (path === "/404") continue;
      expect(sitemap, path).toContain(`<loc>https://zenod.dev${path === "/" ? "/" : path}</loc>`);
    }
  });

  it("tells Google which profiles are ours in one Organization record on the home page", () => {
    const json = tag(read("index.html"), /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const graph = JSON.parse(json)["@graph"] as { "@type": string; name: string; sameAs?: string[] }[];
    const orgs = graph.filter((node) => node["@type"] === "Organization");
    expect(orgs).toHaveLength(1);
    expect(orgs[0].name).toBe("Zenod Memory");
    expect(orgs[0].sameAs).toEqual(
      expect.arrayContaining(["https://github.com/zenod-ai", "https://www.youtube.com/@ZenodMemory", "https://x.com/ZenodMemory"]),
    );
  });

  it("answers the three searches: what it is, vs Basic Memory and Mem0, not Zenodo", () => {
    const what = renderToString(createElement(App, { path: "/zenod-memory" }));
    expect(what).toContain("Zenod Memory is one memory for you and all your AI tools.");
    const vs = renderToString(createElement(App, { path: "/zenod-vs-basic-memory-mem0" }));
    expect(vs).toContain("Basic Memory");
    expect(vs).toContain("Mem0");
    const zenodo = renderToString(createElement(App, { path: "/zenod-vs-zenodo" }));
    expect(zenodo).toContain("Zenod is not Zenodo.");
    expect(zenodo).toContain('href="https://zenodo.org/"');
  });
});
