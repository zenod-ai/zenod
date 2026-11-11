import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./src/App";

afterEach(() => vi.unstubAllGlobals());

function render(pathname: string) {
  vi.stubGlobal("window", { location: { pathname } });
  return renderToStaticMarkup(createElement(App));
}

describe("Paper landing (ZAL-A9 redo of ZAL-A6)", () => {
  it("tells Jordi's story in order: voice in, MCP, kept, filed, graph, editor, ask, strength, custody, console, pricing last", () => {
    const html = render("/");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const order = ["mcp", "how", "kept", "filed", "graph", "constellation", "save", "ask", "strength", "yours", "console", "start"];
    const at = order.map((id) => html.indexOf(`id="${id}"`));
    for (const index of at) expect(index).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain("WhatsApp");
    expect(html).toContain("Claude Code");
  });

  it("shows each benefit after its screenshot, and every screenshot has a real description", () => {
    const html = render("/");
    for (const section of html.matchAll(/<section class="pp-show[^"]*"[^>]*>([\s\S]*?)<\/section>/g)) {
      const body = section[1];
      expect(body.indexOf("<img")).toBeGreaterThan(-1);
      expect(body.indexOf("<img")).toBeLessThan(body.indexOf("<h2"));
    }
    expect(html.match(/<section class="pp-show/g)).toHaveLength(6);
    for (const match of html.matchAll(/<img[^>]*alt="([^"]*)"/g)) expect(match[1].length).toBeGreaterThan(60);
  });

  it("keeps the public offer and a checkout that stays closed until paid signup is ready", () => {
    const html = render("/").replace(/\s+/g, " ");
    expect(html).toContain("€9/month + VAT");
    expect(html).toMatch(/Self-host Zenod free with your AI provider and Telegram/);
    expect(html).toMatch(/managed AI usage and WhatsApp included/);
    expect(html).toContain("Hosted beta opening soon");
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).not.toMatch(/€5|€50|yearly|annual|\$3/i);
  });

  it("keeps anchors unique and resolvable, with /pricing and /connect reachable", () => {
    const html = render("/");
    const ids = [...html.matchAll(/(?<![\w-])id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const match of html.matchAll(/href="\/?#([^"]+)"/g)) expect(ids).toContain(match[1]);
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/connect"');
    const pricing = render("/pricing");
    expect(pricing).toContain("Zenod plans");
    expect(pricing).not.toContain('class="pp"');
    expect(render("/connect")).toContain("cloud.zenod.dev/mcp");
  });

  it("loads its fonts from the bundle, never from a third-party font host", () => {
    const source = readFileSync(new URL("./src/components/paper-landing.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("./src/paper.css", import.meta.url), "utf8");
    expect(`${source}\n${css}`).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });

  it("renders screenshots whose replies and tool calls match production word for word (root L-6)", () => {
    const shot = (name: string) => readFileSync(new URL(`./shots/${name}.html`, import.meta.url), "utf8");
    const runtime = readFileSync(new URL("../../packages/server/src/phylaxPortedRuntime.ts", import.meta.url), "utf8");
    const receipt = readFileSync(new URL("../../packages/server/src/phylaxCaptureReceipt.ts", import.meta.url), "utf8");
    const mcp = readFileSync(new URL("../../packages/server/src/mcp.ts", import.meta.url), "utf8");
    const evidence = readFileSync(new URL("../../packages/core/src/engine/evidence.ts", import.meta.url), "utf8");
    const files = readFileSync(new URL("../../packages/core/src/vault/files.ts", import.meta.url), "utf8");
    // The WhatsApp acknowledgement and invitation are the exact strings the voice path sends.
    const whatsapp = shot("whatsapp");
    const ack = whatsapp.match(/<div class="msg">(I received your voice note[^<]+)</)![1];
    expect(runtime).toContain(`'${ack}'`);
    expect(receipt).toContain('"reply to this message to discuss or act on it"');
    expect(whatsapp).toContain("reply to this message to discuss or act on it");
    // Every tool shown is a real customer tool, and the queued text is the server's.
    const agents = shot("learn") + shot("recall");
    for (const tool of ["search_memory", "get_memory", "store_memory", "get_task_result"]) {
      expect(mcp).toContain(`"${tool}"`);
      expect(agents).toContain(`zenod - ${tool}`);
    }
    expect(mcp).toContain("This runs in the background — poll get_task_result with this ticket_id until state is 'done'.");
    expect(agents).toContain("This runs in the background — poll get_task_result with this ticket_id until state is 'done'.");
    // Log entries and filed pages use the vault's real shapes and folders.
    expect(evidence).toContain("`- content-type: ${singleLine(metadata.contentType)}`");
    expect(shot("log")).toContain("- content-type: voice_note");
    for (const path of [...whatsapp.matchAll(/(\w+)\/[\w ]+\.md/g)].map((match) => match[1]))
      expect(files).toContain(`${path}: "`);
    // Commits carry the engine's author and message prefix.
    expect(shot("history")).toContain("zenod-bot");
    expect(shot("history")).toContain("memory: capture voice_note");
  });

  it("says early that AI tools connect over MCP from the cloud, with a visual and the real connect page", () => {
    const html = render("/");
    const mcp = html.slice(html.indexOf('id="mcp"'), html.indexOf('id="how"'));
    expect(html.indexOf('id="mcp"')).toBeLessThan(html.indexOf('id="kept"'));
    expect(mcp).toContain("over MCP, from the cloud");
    expect(mcp).toContain("cloud.zenod.dev/mcp");
    for (const tool of ["WhatsApp", "Claude", "ChatGPT", "Codex", "Cursor", "VS Code", "Gemini CLI"]) expect(mcp).toContain(tool);
    expect(mcp).toContain("dev.zenod/memory");
    expect(mcp).toContain('href="/connect"');
    expect(mcp).toMatch(/class="mv-stage scene mv-hub"[^>]*role="img"[^>]*aria-label="[^"]{60,}"/);
  });

  it("opens with five short animated moves before the MCP section (EPIC-25)", () => {
    const html = render("/");
    const order = ["how-zenod-works", "forever", "cloud", "helpers", "librarian", "mcp", "kept"];
    const at = order.map((id) => html.indexOf(`id="${id}"`));
    for (const index of at) expect(index).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const moves = html.slice(at[0], at[5]);
    expect(moves).toContain("forever, exactly as you said them");
    expect(moves).toContain("Google Drive or GitHub");
    expect(moves).toContain("cloud of thoughts");
    expect(moves).toContain("Helpers read it and add new memories");
    expect(moves).toContain("Zenod is the librarian");
    expect(html).toContain("One memory that every AI reads and writes.");
    // Every stage is a scene with a description, so the final frame says it without motion.
    expect(html.match(/class="mv-stage scene[^"]*"[^>]*role="img"[^>]*aria-label="[^"]{60,}"/g)).toHaveLength(5);
  });

  it("marks the graph view and match strengths live, each with a real screen of the app (EPIC-18 W4)", () => {
    const html = render("/");
    // Three product scenes plus the five moves (the fifth replaced the old MCP scene).
    expect(html.match(/class="[^"]*\bscene\b[^"]*"/g)!.length).toBe(8);
    // Everything on the page shipped: no Coming tag is left.
    expect(html).not.toContain("pp-tag-soon");
    const graph = html.slice(html.indexOf('id="graph"'), html.indexOf('id="constellation"'));
    expect(graph.match(/pp-tag-live/g)!.length).toBe(2);
    expect(graph).toContain("Graph tab");
    expect(graph).toMatch(/<img[^>]*src="[^"]*graph-live[^"]*\.webp"[^>]*alt="[^"]{60,}"/);
    expect(graph).toMatch(/srcSet="[^"]*graph-live-phone[^"]*\.webp"/);
    const strength = html.slice(html.indexOf('id="strength"'), html.indexOf('id="yours"'));
    expect(strength).toContain("pp-tag-live");
    expect(strength).not.toContain("is coming");
    expect(strength).toContain("Show in graph");
    expect(strength).toMatch(/<img[^>]*src="[^"]*lit[^"]*\.webp"[^>]*alt="[^"]{60,}"/);
    expect(strength).toMatch(/data-p="92"/);
    expect(strength).toContain('data-type="Lisbon flat and the landlord"');
    // The scene markup is static: without script every step is visible, and no link leads nowhere.
    for (const name of ["whatsapp", "retrieval-screen", "retrieval-results", "constellation"]) {
      const scene = readFileSync(new URL(`./src/scenes/${name}.html`, import.meta.url), "utf8");
      expect(scene).not.toMatch(/href=/);
    }
  });

  it("explains the weighted memory graph as a constellation, with a retrieval at 80% that follows the strong paths (EPIC-18 W2)", () => {
    const html = render("/").replace(/\s+/g, " ");
    const cst = html.slice(html.indexOf('id="constellation"'), html.indexOf('id="save"'));
    expect(cst).toContain("Live");
    expect(cst).toContain("librarian that keeps an index of your memory");
    expect(cst).toContain("above 80%");
    for (const weight of ["100%", "60%", "5%"]) expect(cst).toContain(`>${weight}<`);
    expect(cst).toContain("1 × 0.9 × 0.95 = 0.855");
    expect(cst).toMatch(/<svg class="g cst"[^>]*role="img"[^>]*aria-label="[^"]{80,}"/);
    // Every kept memory is a path whose multiplied strength stays at or above 0.8; every faded one falls below.
    const scene = readFileSync(new URL("./src/scenes/constellation.html", import.meta.url), "utf8");
    expect(scene.match(/class="cp"/g)).toHaveLength(5);
    expect(scene.match(/class="c[en] weak"/g)).toHaveLength(10);
    expect(cst).toMatch(/Left out, below 0\.8: Timber yard receipt 0\.77/);
  });

  it("plays the WhatsApp scene with production's replies word for word (root L-6)", () => {
    const scene = readFileSync(new URL("./src/scenes/whatsapp.html", import.meta.url), "utf8");
    const runtime = readFileSync(new URL("../../packages/server/src/phylaxPortedRuntime.ts", import.meta.url), "utf8");
    const channels = readFileSync(new URL("../../packages/server/src/phylaxChannels.ts", import.meta.url), "utf8");
    const files = readFileSync(new URL("../../packages/core/src/vault/files.ts", import.meta.url), "utf8");
    const ack = scene.match(/data-at="2900">(I received your voice note[^<]+)</)![1];
    expect(runtime).toContain(`'${ack}'`);
    for (const line of ['"Saved ✓"', "`Recap: ${recap}`", '"Google Drive audio"', '"Transcription: completed."', "`Transcript: ${", "`Filed: ${"])
      expect(channels).toContain(line);
    for (const line of ["Saved ✓", "Recap: ", "Google Drive audio: ", "Transcription: completed.", "Transcript: ", "Filed: ", "reply to this message to discuss or act on it"])
      expect(scene).toContain(line);
    for (const folder of [...scene.matchAll(/(\w+)\/[\w ]+\.md/g)].map((match) => match[1])) expect(files).toContain(`${folder}: "`);
  });

  it("points Hosted at the real sign-in and live checkout, and every other action at a live page", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { PaperLanding } = await import("./src/components/paper-landing");
    vi.stubGlobal("window", { location: { pathname: "/" } });
    const subscribe = vi.fn();
    const ready = renderToStaticMarkup(createElement(PaperLanding, { customer: { signedIn: false, busyTier: null, error: null, paidSignupReady: true, subscribe } }));
    expect(ready).toContain("Start with Google");
    expect(ready).toContain("Start with GitHub");
    expect(ready).not.toContain("Hosted beta opening soon");
    const signedIn = renderToStaticMarkup(createElement(PaperLanding, { customer: { signedIn: true, busyTier: null, error: null, paidSignupReady: true, subscribe } }));
    expect(signedIn).toContain("Choose Hosted");
    expect(signedIn).toContain('href="https://cloud.zenod.dev/app"');
    const app = readFileSync(new URL("./src/App.tsx", import.meta.url), "utf8");
    expect(app).toContain("window.location.assign(signInPath)");
    expect(app).toContain("window.location.assign(await createHostedCheckout(tier))");
    const hrefs = [...ready.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    for (const href of hrefs) expect(href).toMatch(/^(#|\/connect$|\/pricing$|\/testers$|\/legal\/|\/auth\/google\/start$|\/$|https:\/\/github\.com\/zenod-ai\/zenod)/);
  });

  it("opens the testers program on /testers with the apply form, and links it from home (ZAL-A13)", () => {
    const home = render("/");
    expect(home).toContain('href="/testers"');
    expect(home).toContain("Have a tester code? Enter it at checkout.");
    const testers = render("/testers").replace(/\s+/g, " ");
    expect(testers.match(/<h1\b/g)).toHaveLength(1);
    expect(testers).toContain("How are you going to be using Zenod Memory?");
    const field = (name: string) => testers.match(new RegExp(`<(?:input|textarea)[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
    expect(field("use")).toContain('required=""');
    expect(field("contact")).toContain('required=""');
    expect(field("website")).toMatch(/tabindex="-1"/i);
    for (const line of ["A free month of Zenod Hosted", "No card needed.", "The free month ends by itself", "one at a time", "never automatic", "Nothing is ever charged unless you choose to pay", "Usage is capped", "everything you send is still kept", "first ten", "a few weeks", "send us a line"])
      expect(testers).toContain(line);
    // EPIC-26 T1: the three things a tester gets come first, in this order.
    const promises = [
      "A WhatsApp number for your voice notes.",
      "Your memory, word for word, in your own account.",
      "A knowledge graph any AI can read and write.",
    ].map((line) => testers.indexOf(line));
    expect(promises.every((at) => at > 0)).toBe(true);
    expect([...promises].sort((a, b) => a - b)).toEqual(promises);
    expect(promises[0]).toBeLessThan(testers.indexOf("What it costs"));
    expect(testers).toContain("Google Drive or GitHub");
    expect(testers).toContain('href="/connect"');
    // Section links from a sub-page land on the home page's sections.
    expect(testers).toContain('href="/#how"');
    expect(testers).not.toMatch(/href="#(how|mcp|start)"/);
  });

  it("carries a tester code from /testers?code= into the one-link funnel (EPIC-26 T1)", () => {
    vi.stubGlobal("window", { location: { pathname: "/testers", search: "?code=TESTER1" } });
    const withCode = renderToStaticMarkup(createElement(App)).replace(/\s+/g, " ");
    expect(withCode).toContain('href="https://cloud.zenod.dev/join?code=TESTER1"');
    expect(withCode).toContain("Start with your code");
    vi.stubGlobal("window", { location: { pathname: "/testers", search: "?code=%3Cb%3E" } });
    const hostile = renderToStaticMarkup(createElement(App));
    expect(hostile).not.toContain("cloud.zenod.dev/join");
    const plain = render("/testers").replace(/\s+/g, " ");
    expect(plain).not.toContain("Start with your code");
    expect(plain).toContain("a personal link right after applying, with a code inside that works once");
  });

  it("fixes the walk's sign-up path defects on /pricing and /connect (ZAL-A13)", () => {
    const homeIds = [...render("/").matchAll(/(?<![\w-])id="([^"]+)"/g)].map((match) => match[1]);
    for (const path of ["/pricing", "/connect"]) {
      const html = render(path);
      const anchors = [...html.matchAll(/href="\/#([^"]+)"/g)].map((match) => match[1]);
      expect(anchors.length).toBeGreaterThan(0);
      for (const anchor of anchors) expect(homeIds).toContain(anchor);
      expect(html).toContain('class="pp-menu"');
      expect(html).toContain("Sign in");
    }
    const pricing = render("/pricing");
    expect(pricing).not.toMatch(/href="\/pricing"[^>]*>Get started/);
    expect(pricing).toMatch(/href="#start"[^>]*>Get started/);
    const css = readFileSync(new URL("./src/index.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/\.v5-signin \{ display: none; \}/);
  });

  it("gives /pricing and /connect the home page's header and Z (ZAL-A17)", () => {
    const homeHeader = render("/").match(/<header class="pp-nav">[\s\S]*?<\/header>/)?.[0];
    expect(homeHeader).toBeTruthy();
    for (const path of ["/pricing", "/connect"]) {
      const html = render(path);
      expect(html).toContain('<div class="pp pp-bar"><header class="pp-nav">');
      expect(html).toContain('<a class="pp-brand" href="/" aria-label="Zenod home">Zenod</a>');
      expect(html).not.toContain('class="v5-nav"');
      expect(html).toContain("v5-paper");
    }
    // Content stays: the plans and the connect steps.
    expect(render("/pricing")).toContain("Start free. Stay in control.");
    expect(render("/connect")).toContain("cloud.zenod.dev/mcp");
    // The listing icon is the favicon: the Newsreader Z on parchment (E25-S1 round 3, Jordi kept the earlier Z).
    const icon = readFileSync(new URL("./public/brand/zenod-icon.svg", import.meta.url), "utf8");
    expect(icon).toBe(readFileSync(new URL("./public/favicon.svg", import.meta.url), "utf8"));
  });

  it("renders the not-found page that 404.html marks, with links that work from both hosts (ZAL-A19)", () => {
    vi.stubGlobal("document", { body: { dataset: { page: "not-found" } } });
    const html = render("/no-such-page");
    expect(html).toContain("This page does not exist.");
    expect(html).toContain('href="https://zenod.dev/"');
    expect(html).toContain('href="https://cloud.zenod.dev/app"');
    const page = readFileSync(new URL("./404.html", import.meta.url), "utf8");
    expect(page).toContain('data-page="not-found"');
    expect(page).toContain('content="noindex"');
  });

  it("names the demo data in the footer", () => {
    expect(render("/")).toContain("Screens show the real product with demo people and notes.");
  });
});
