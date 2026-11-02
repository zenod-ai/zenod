import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listMarkdownFiles } from "./files.js";

/**
 * Who a Log entry came from (EPIC-9 E9-2g). Freshness in the memory tree is the
 * person's own activity: what they sent on WhatsApp, Telegram, the web or Drive,
 * or asked an assistant to remember. Agent reports written over MCP (wake and
 * Watcher reads, ticket closures, deploy notes) are content, never freshness:
 * otherwise a busy agent fleet makes its own topics look like what the person is
 * working on (seen in E9-A4).
 */
export type CaptureOrigin = "user" | "agent";

export interface LogCapture {
  /** `2026-11-02#^e-abcdef`, the form a page citation names. */
  key: string;
  date: string;
  anchor: string;
  source: string | null;
  title: string;
  content: string;
  origin: CaptureOrigin;
}

/** Surfaces a person types or speaks into directly: always their own capture. */
const PERSON_SOURCES = new Set(["whatsapp", "telegram", "web", "drive"]);
/** Machine-only surfaces. */
const MACHINE_SOURCES = new Set(["selftest"]);

/**
 * Markers of an agent report: ticket and epic ids (also in parentheses, `(T3)`,
 * `(E7-A12)`, `C9-15`, `L-38`, `P-0004`), run ids, commit shas next to a deploy
 * word, PR numbers, wake/Watcher reads, delivery-manager and console vocabulary.
 * A person asking an assistant "remember that..." over MCP writes none of these.
 */
const AGENT_MARK_RE = new RegExp([
  String.raw`\bEPIC-\d`,
  String.raw`\b[A-Z]\d{1,3}-[A-Z]{0,3}\d`,
  String.raw`\bZAL-?\d`,
  String.raw`\b(?:L|P|DOD)-\d{1,4}\b`,
  String.raw`\(\s*T\d+(?:\.\d+)?\s*\)`,
  String.raw`\brun_[0-9a-f]{6,}`,
  String.raw`\bagent_team\b`,
  String.raw`\bcommit [0-9a-f]{7,40}\b`,
  String.raw`\b[0-9a-f]{7,40}\b[^\n]{0,40}\b(?:live|deployed|merged)\b`,
  String.raw`\b(?:live|deployed|merged)(?: on| at)?(?: \w+)? [0-9a-f]{7,40}\b`,
  String.raw`\bPR #?\d+`,
  String.raw`(?:^|\s)#\d{3,}\b`,
  String.raw`\bwake\b`,
  String.raw`\bWatcher\b`,
  String.raw`\bdispatched\b`,
  String.raw`\bDelivery Manager\b`,
  String.raw`\bReady: yes\b`,
].join("|"), "i");

/**
 * The first words name an agent, repo or host rather than a subject: a lowercase
 * slug (`zenod-social,`, `infra-vps`, `hair_flow`, `es-prod-tester-aec5 (`), a
 * host (`VPS1 2026-10-30:`), or a `Run:`/`[agent]` header. People do not open a
 * note that way. Case-sensitive on purpose.
 */
const AGENT_HEAD_RE = /^\s*(?:\d{4}-\d{2}-\d{2}:?\s+)?(?:[a-z0-9]+(?:[-_][a-z0-9]+)+(?:\s*[,(]|\s+(?:\d{4}-\d{2}-\d{2}|EPIC-|[A-Z]+\d|console\b|Watcher\b|Scout\b|Writer\b|Publisher\b|Reporter\b))|VPS\d+\b|Run:\s|\[[\w -]{2,30}\]\s)/;

/** Text that reads as an agent report, whatever surface carried it (first 800 characters). */
export function readsAsAgentReport(text: string): boolean {
  const head = text.slice(0, 800);
  return AGENT_HEAD_RE.test(head) || AGENT_MARK_RE.test(head);
}

/** Surfaces a person types or speaks into directly. */
export function isPersonSource(source: string | null | undefined): boolean {
  return PERSON_SOURCES.has((source ?? "").trim().toLowerCase());
}

export function captureOrigin(source: string | null | undefined, text: string): CaptureOrigin {
  const surface = (source ?? "").trim().toLowerCase();
  if (PERSON_SOURCES.has(surface)) return "user";
  if (MACHINE_SOURCES.has(surface)) return "agent";
  // mcp, cli and legacy entries without a source: an agent report only when it reads as one.
  return readsAsAgentReport(text) ? "agent" : "user";
}

/** Body without the `## Ops rollup` section (E9-2b rule 5): agent traffic is not what a page is about, nor anyone's activity. */
export function withoutOpsRollup(body: string): string {
  const heading = "## Ops rollup";
  const start = body.indexOf(`\n${heading}\n`);
  if (start < 0) return body;
  const rest = body.slice(start + heading.length + 2);
  const next = rest.search(/^## /m);
  return body.slice(0, start) + (next < 0 ? "" : `\n${rest.slice(next)}`);
}

const HEADING_RE = /^## (\d{2}:\d{2}) (.*?)\s+\^(e-[0-9a-f]{6})\s*$/;

/** Parse one `Log/YYYY-MM-DD.md` file into its entries. */
export function parseLogCaptures(date: string, raw: string): LogCapture[] {
  const out: LogCapture[] = [];
  let current: { anchor: string; title: string; source: string | null; content: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const content = current.content.join("\n").trim();
    out.push({
      key: `${date}#^${current.anchor}`, date, anchor: current.anchor, source: current.source, title: current.title, content,
      origin: captureOrigin(current.source, `${current.title}\n${content}`),
    });
  };
  for (const line of raw.split("\n")) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      current = { anchor: heading[3]!, title: heading[2]!, source: null, content: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("- source: ")) current.source = line.slice("- source: ".length).trim();
    else if (line.startsWith("> ")) current.content.push(line.slice(2));
  }
  flush();
  return out;
}

/** Every Log entry in the vault, keyed `YYYY-MM-DD#^e-xxxxxx`. */
export async function readLogCaptures(vaultPath: string, files?: string[]): Promise<Map<string, LogCapture>> {
  const out = new Map<string, LogCapture>();
  for (const file of files ?? (await listMarkdownFiles(vaultPath))) {
    const match = /^Log\/(\d{4}-\d{2}-\d{2})\.md$/.exec(file);
    if (!match) continue;
    const raw = await readFile(join(vaultPath, file), "utf8").catch(() => "");
    for (const capture of parseLogCaptures(match[1]!, raw)) out.set(capture.key, capture);
  }
  return out;
}
