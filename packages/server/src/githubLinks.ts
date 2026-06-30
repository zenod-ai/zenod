/**
 * Turn `owner/repo#N` references into clickable GitHub issue links in outbound
 * messages. Applied at the gateway send layer so EVERY surface (runner notifies,
 * Console replies) gets links uniformly.
 *
 * Surfaces differ in what they can render:
 * - markdown surfaces (Telegram rich, web): inline `[owner/repo#N](url)`.
 * - plain surfaces (WhatsApp): can't hyperlink arbitrary text, only auto-link bare
 *   URLs — so append a deduped footer of `owner/repo#N: <url>` lines instead.
 */

// owner/repo#123 — not when preceded by a word char, '/', '.', '-' or '[' (so we
// never match inside a URL path or an existing markdown link).
const REF_RE = /(?<![\w/.[-])([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/g;

function issueUrl(repo: string, n: string): string {
  return `https://github.com/${repo}/issues/${n}`;
}

export function linkifyGithubRefs(text: string, opts: { markdown?: boolean } = {}): string {
  if (!text) return text;

  if (opts.markdown) {
    return text.replace(REF_RE, (match, repo: string, n: string, offset: number, full: string) => {
      // Skip refs that are already the text of a markdown link (followed by "](" ).
      if (full.slice(offset + match.length, offset + match.length + 2) === "](") return match;
      return `[${repo}#${n}](${issueUrl(repo, n)})`;
    });
  }

  // Plain surface: collect unique refs and append a links footer (bare URLs auto-link).
  const seen = new Set<string>();
  const links: string[] = [];
  for (const m of text.matchAll(REF_RE)) {
    const repo = m[1]!;
    const n = m[2]!;
    const key = `${repo}#${n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const url = issueUrl(repo, n);
    if (text.includes(url)) continue; // already linked/printed in the message
    links.push(`${key}: ${url}`);
  }
  if (!links.length) return text;
  return `${text}\n\n${links.join("\n")}`;
}
