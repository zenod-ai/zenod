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
  it("tells Jordi's story in order: hero, seven animated diagrams, pricing last (E25-S3 it2)", () => {
    const html = render("/");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const order = ["how", "forever", "cloud", "mcp", "librarian", "kept", "yours", "helpers", "start"];
    const at = order.map((id) => html.indexOf(`id="${id}"`));
    for (const index of at) expect(index).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain("WhatsApp");
    // Jordi, vn_668d73df: no screenshot sections, no garden example, no made-up names.
    for (const gone of ['id="console"', 'id="graph"', 'id="constellation"', 'id="strength"', "pp-show", "<img"]) expect(html).not.toContain(gone);
    expect(html).not.toMatch(/garden shed|\bshed\b|cedar|westcomb|cabin decision/i);
  });
  it("explains the raw file and the organized file, and that the organized one can be made again (E25-S3 it2)", () => {
    const html = render("/").replace(/\s+/g, " ");
    const kept = html.slice(html.indexOf('id="kept"'), html.indexOf('id="yours"'));
    expect(kept).toContain("Kept exactly as you said it.");
    expect(kept).toContain("Raw file");
    expect(kept).toContain("Kept forever. Never edited.");
    expect(kept).toContain("Organized file · made again");
    const yours = html.slice(html.indexOf('id="yours"'), html.indexOf('id="helpers"'));
    for (const line of ["The library is yours.", "Voice note", "Zenod", "Your Google Drive", "Your GitHub repo", "Obsidian"]) expect(yours).toContain(line);
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
    const words = readFileSync(new URL("../../packages/server/src/voiceReplyWords.ts", import.meta.url), "utf8");
    const mcp = readFileSync(new URL("../../packages/server/src/mcp.ts", import.meta.url), "utf8");
    const evidence = readFileSync(new URL("../../packages/core/src/engine/evidence.ts", import.meta.url), "utf8");
    const files = readFileSync(new URL("../../packages/core/src/vault/files.ts", import.meta.url), "utf8");
    // The WhatsApp acknowledgement and saved reply are the exact strings the voice path sends (E7-S35: one line each).
    const whatsapp = shot("whatsapp");
    const ack = whatsapp.match(/<div class="msg">(Got it[^<]+)</)![1];
    expect(words).toContain(`VOICE_RECEIVED_REPLY = "${ack}"`);
    expect(words).toContain("`Saved ✓ ${transcribed ? \"Full text\" : \"Open\"}: ${link}`");
    expect(whatsapp).toContain("Saved ✓ Full text: ");
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
    const mcp = html.slice(html.indexOf('id="mcp"'), html.indexOf('id="librarian"'));
    expect(html.indexOf('id="mcp"')).toBeLessThan(html.indexOf('id="kept"'));
    expect(mcp).toContain("Over MCP, from the cloud");
    expect(mcp).toContain("cloud.zenod.dev/mcp");
    for (const tool of ["WhatsApp", "Claude", "ChatGPT", "Codex", "Cursor", "VS Code", "Gemini CLI"]) expect(mcp).toContain(tool);
    expect(mcp).toContain("MCP Registry as Zenod");
    expect(mcp).not.toMatch(/dev[.]zenod/i);
    expect(mcp).toContain('href="/connect"');
    expect(mcp).toMatch(/class="mv-stage scene mv-hub"[^>]*role="img"[^>]*aria-label="[^"]{60,}"/);
  });
  it("shows every idea as one animated diagram, connecting agents third and helpers last (EPIC-25, E25-S3 it2)", () => {
    const html = render("/");
    const moves = html.slice(html.indexOf('id="how"'), html.indexOf('id="start"'));
    expect(moves).toContain("forever, exactly as you said them");
    expect(moves).toContain("Google Drive or GitHub");
    expect(moves).toContain("cloud of thoughts");
    expect(moves).toContain("Connect all your agents to one memory.");
    expect(moves).toContain("Zenod is the librarian");
    expect(moves).toContain("Send agents to mine your memory.");
    for (const helper of ["Open loops", "Weekly recap", "Something to try", "Patterns and ideas", "Ideas digest", "Topic gardener"]) expect(moves).toContain(helper);
    expect(moves).not.toContain("Still building");
    // The librarian is drawn with arrows in and out.
    const lib = html.slice(html.indexOf('id="librarian"'), html.indexOf('id="kept"'));
    expect(lib.match(/class="mv-arrow[ "]/g)!.length).toBe(4);
    // Every stage is a scene with a description, so the final frame says it without motion.
    expect(html.match(/class="mv-stage scene[^"]*"[^>]*role="img"[^>]*aria-label="[^"]{60,}"/g)).toHaveLength(7);
    expect(html).not.toContain("pp-tag-soon");
  });
  it("plays the WhatsApp scene with production's replies word for word (root L-6)", () => {
    const scene = readFileSync(new URL("./src/scenes/whatsapp.html", import.meta.url), "utf8");
    const words = readFileSync(new URL("../../packages/server/src/voiceReplyWords.ts", import.meta.url), "utf8");
    const files = readFileSync(new URL("../../packages/core/src/vault/files.ts", import.meta.url), "utf8");
    const ack = scene.match(/data-at="2900">(Got it[^<]+)</)![1];
    expect(words).toContain(`VOICE_RECEIVED_REPLY = "${ack}"`);
    expect(words).toContain("`Saved ✓ ${transcribed ? \"Full text\" : \"Open\"}: ${link}`");
    expect(scene).toContain("Saved ✓ Full text: ");
    expect(scene).not.toContain("Transcript: ");
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
    const testers = render("/testers").replace(/<!-- -->/g, "").replace(/\s+/g, " ");
    expect(testers.match(/<h1\b/g)).toHaveLength(1);
    expect(testers).toContain("Optional: how will you use it? One line helps us.");
    const field = (name: string) => testers.match(new RegExp(`<(?:input|textarea)[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
    expect(field("use")).not.toContain("required"); // E26-S34: optional
    expect(field("contact")).toContain('required=""');
    expect(field("website")).toMatch(/tabindex="-1"/i);
    for (const line of ["Your first 30 memories free. No card.", "Take as long as you like to reach 30.", "When you reach 30, Zenod stays free until the end of that month.", "never charged unless you choose to pay", "Usage is capped", "everything you send is still kept", "first ten", "a few weeks", "send us a line"])
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
    // EPIC-7 T13: the first screen leads to the form, not to the €9 pricing, and phones get the Menu.
    expect(testers).toMatch(/<a class="pp-btn pp-btn-small" href="#apply">Apply<\/a>/);
    expect(testers.indexOf('href="#apply">Apply now')).toBeLessThan(testers.indexOf("What you get"));
    expect(testers).toContain("<summary>Menu</summary>");
  });

  it("shows the same sample memory on the home page after the hero, with one way on to /testers (E26-S37)", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { PaperLanding } = await import("./src/components/paper-landing");
    vi.stubGlobal("window", { location: { pathname: "/" } });
    const home = renderToStaticMarkup(createElement(PaperLanding, { customer: { signedIn: false, busyTier: null, error: null, paidSignupReady: true, subscribe: vi.fn() } })).replace(/<!-- -->/g, "").replace(/\s+/g, " ");
    const sample = home.indexOf('data-testid="sample-memory"');
    expect(sample).toBeGreaterThan(home.indexOf("pp-hero"));
    expect(sample).toBeLessThan(home.indexOf('id="how"') > 0 ? home.indexOf('id="how"') : home.indexOf("pp-plans-sec"));
    expect(home).toContain("Sara’s week, as Zenod keeps it.");
    expect((home.match(/data-testid="sample-memory"/g) ?? []).length).toBe(1);
    // the home page's way on is /testers, never the testers page's own #apply anchor
    expect(home).toContain('href="/testers">Become a tester and try it with your voice notes');
    const section = home.slice(sample, home.indexOf("</section>", sample));
    expect(section).not.toMatch(/garden|Westcombe/i);
  });

  it("shows a read-only sample memory, Sara's week, above the promises and the form (E26-S35)", () => {
    const testers = render("/testers").replace(/<!-- -->/g, "").replace(/\s+/g, " ");
    const sample = testers.indexOf('data-testid="sample-memory"');
    expect(sample).toBeGreaterThan(0);
    expect(sample).toBeLessThan(testers.indexOf("What you get"));
    expect(sample).toBeLessThan(testers.indexOf('id="apply"'));
    expect(sample).toBeGreaterThan(testers.indexOf('href="#apply">Apply now'));
    expect(testers).toContain("Sara’s week, as Zenod keeps it.");
    // A thought is open from the start, showing the voice note it came from, word for word.
    expect(testers).toContain("Sara’s birthday is Saturday. Book dinner for six at the Italian place.");
    expect(testers.match(/class="sm-n[^"]*" role="button" tabindex="0"/g)?.length).toBe(7);
    expect(testers).not.toMatch(/garden|\bshed\b|westcomb|cabin/i);
    expect(testers).toContain("Your first 30 memories free. No card.");
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
    expect(plain).toContain("a personal tester link right here after applying, with a code inside that works once");
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
    expect(render("/")).toContain("Examples use demo people and notes.");
  });
});
