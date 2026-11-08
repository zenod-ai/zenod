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
    const order = ["mcp", "how", "kept", "filed", "graph", "save", "ask", "strength", "yours", "console", "start"];
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
    for (const tool of ["Claude", "ChatGPT", "Cursor", "VS Code", "Gemini CLI"]) expect(mcp).toContain(tool);
    expect(mcp).toContain("dev.zenod/memory");
    expect(mcp).toContain('href="/connect"');
    expect(mcp).toMatch(/class="pp-mcp-stage scene"[^>]*role="img"[^>]*aria-label="[^"]{60,}"/);
  });

  it("brings in the deck's three scenes, marking what is coming", () => {
    const html = render("/");
    expect(html.match(/class="[^"]*\bscene\b[^"]*"/g)!.length).toBe(4);
    const graph = html.slice(html.indexOf('id="graph"'), html.indexOf('id="save"'));
    expect(graph).toContain("Coming");
    expect(graph).toContain("Voice note, today");
    const strength = html.slice(html.indexOf('id="strength"'), html.indexOf('id="yours"'));
    expect(strength).toContain("Coming");
    expect(strength).toMatch(/data-p="92"/);
    expect(strength).toContain('data-type="Lisbon flat and the landlord"');
    // The scene markup is static: without script every step is visible, and no link leads nowhere.
    for (const name of ["whatsapp", "graph", "retrieval-screen", "retrieval-results"]) {
      const scene = readFileSync(new URL(`./src/scenes/${name}.html`, import.meta.url), "utf8");
      expect(scene).not.toMatch(/href=/);
    }
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
    for (const href of hrefs) expect(href).toMatch(/^(#|\/connect$|\/pricing$|\/legal\/|\/auth\/google\/start$|\/$|https:\/\/github\.com\/zenod-ai\/zenod)/);
  });

  it("names the demo data in the footer", () => {
    expect(render("/")).toContain("Screens show the real product with demo people and notes.");
  });
});
