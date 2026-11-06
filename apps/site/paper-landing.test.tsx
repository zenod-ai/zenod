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
  it("tells Jordi's story in order: voice in, kept, filed, editor, ask, custody, console, offer", () => {
    const html = render("/");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const order = ["how", "kept", "filed", "save", "ask", "yours", "console", "start"];
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
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
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

  it("names the demo data in the footer", () => {
    expect(render("/")).toContain("Screens show the real product with demo people and notes.");
  });
});
