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

describe("Paper landing (ZAL-A6, direction A)", () => {
  it("tells Jordi's story in order: ways in, voice, editor, ingestion, digestion, retrieval, custody, console, mining, offer", () => {
    const html = render("/");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const order = ["ways-in", "voice", "desk", "ingestion", "digestion", "retrieval", "yours", "console", "mine", "name", "start"];
    const at = order.map((id) => html.indexOf(`id="${id}"`));
    for (const index of at) expect(index).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain("WhatsApp");
    expect(html).toContain("Claude Code");
    expect(html).not.toContain('class="zls-story"');
  });

  it("draws every diagram twice, wide and tall, each with an accessible label", () => {
    const html = render("/");
    expect(html.match(/class="pp-d-wide"/g)).toHaveLength(3);
    expect(html.match(/class="pp-d-tall"/g)).toHaveLength(3);
    for (const match of html.matchAll(/<svg[^>]*aria-label="([^"]*)"/g))
      expect(match[1].length).toBeGreaterThan(60);
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

  it("shows product visuals whose replies and tool calls match production word for word (root L-6)", () => {
    const html = render("/").replace(/\s+/g, " ");
    const shots = readFileSync(new URL("./src/components/product-shots.tsx", import.meta.url), "utf8");
    const runtime = readFileSync(new URL("../../packages/server/src/phylaxPortedRuntime.ts", import.meta.url), "utf8");
    const receipt = readFileSync(new URL("../../packages/server/src/phylaxCaptureReceipt.ts", import.meta.url), "utf8");
    const mcp = readFileSync(new URL("../../packages/server/src/mcp.ts", import.meta.url), "utf8");
    // The WhatsApp acknowledgement is the exact string the voice path sends.
    const ack = shots.match(/const VOICE_ACK =\s*"([^"]+)"/)![1];
    expect(runtime).toContain(`'${ack}'`);
    expect(receipt).toContain('"reply to this message to discuss or act on it"');
    // Every tool shown is a real customer tool, and the queued text is the server's.
    for (const tool of ["search_memory", "get_memory", "store_memory", "get_task_result"]) {
      expect(mcp).toContain(`"${tool}"`);
      expect(html).toContain(`zenod - ${tool}`);
    }
    expect(mcp).toContain("This runs in the background — poll get_task_result with this ticket_id until state is 'done'.");
    expect(html).toContain("This runs in the background — poll get_task_result with this ticket_id until state is &#x27;done&#x27;.");
    expect(html).toContain("Demo contact and content");
    expect(html).toContain("The real Zenod console, shown with demo data.");
  });
});
