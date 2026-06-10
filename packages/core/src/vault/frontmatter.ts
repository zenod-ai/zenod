import { parse, stringify } from "yaml";

export interface ParsedNote {
  /** null when the file has no frontmatter block. */
  frontmatter: Record<string, unknown> | null;
  body: string;
}

const FM_OPEN = /^---\r?\n/;

/** Split a markdown file into YAML frontmatter and body. Never throws on bad YAML — returns null frontmatter. */
export function parseNote(raw: string): ParsedNote {
  if (!FM_OPEN.test(raw)) return { frontmatter: null, body: raw };

  const close = raw.indexOf("\n---", 3);
  if (close === -1) return { frontmatter: null, body: raw };
  const endOfClose = raw.indexOf("\n", close + 1);
  const yamlBlock = raw.slice(raw.indexOf("\n") + 1, close + 1);
  const body = endOfClose === -1 ? "" : raw.slice(endOfClose + 1);

  try {
    const data = parse(yamlBlock);
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      return { frontmatter: data as Record<string, unknown>, body };
    }
  } catch {
    // fall through — malformed YAML is reported by lint, not thrown here
  }
  return { frontmatter: null, body };
}

export function serializeNote(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.replace(/^\n+/, "")}`;
}
