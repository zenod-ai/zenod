interface ReadSpan {
  path: string;
  text: string;
}

interface EvidenceBlock {
  anchor: string;
  text: string;
}

const EXACT_LITERAL_RE = /\b[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+\b/g;
const EVIDENCE_ANCHOR_RE = /\^(e-[0-9a-f]{6})\b/gi;
const LOG_PATH_RE = /^Log\/(\d{4}-\d{2}-\d{2})\.md$/;

const SCOPE_STOP_WORDS = new Set([
  "about",
  "answer",
  "brain",
  "broad",
  "code",
  "codeword",
  "could",
  "details",
  "from",
  "have",
  "human",
  "know",
  "memory",
  "project",
  "recall",
  "remember",
  "tell",
  "that",
  "their",
  "there",
  "these",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
]);

function exactLiterals(text: string): string[] {
  return [...new Set(text.match(EXACT_LITERAL_RE) ?? [])].filter(
    (literal) => /\d/.test(literal) && !/^e-[0-9a-f]{6}$/i.test(literal),
  );
}

function scopeTerms(question: string): string[] {
  return [
    ...new Set(
      question
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter((term) => term.length >= 3 && !SCOPE_STOP_WORDS.has(term)) ?? [],
    ),
  ];
}

function evidenceBlocks(text: string): EvidenceBlock[] {
  const headings = [...text.matchAll(/^## .*?\s+\^(e-[0-9a-f]{6})\s*$/gim)];
  return headings.map((heading, index) => ({
    anchor: heading[1]!,
    text: text.slice(heading.index!, headings[index + 1]?.index ?? text.length),
  }));
}

function relevantLogText(question: string, text: string): string {
  const blocks = evidenceBlocks(text);
  if (blocks.length === 0) return "";

  const markers = exactLiterals(question);
  if (markers.length > 0) {
    return blocks
      .filter((block) => markers.some((marker) => block.text.includes(marker)))
      .map((block) => block.text)
      .join("\n");
  }

  const terms = scopeTerms(question);
  if (terms.length === 0) return blocks.map((block) => block.text).join("\n");
  const requiredMatches = Math.min(2, terms.length);
  return blocks
    .filter((block) => {
      const lower = block.text.toLowerCase();
      return terms.filter((term) => lower.includes(term)).length >= requiredMatches;
    })
    .map((block) => block.text)
    .join("\n");
}

function scopedSources(question: string, spans: ReadSpan[]): Map<string, string> {
  const scoped = new Map<string, string>();
  for (const span of spans) {
    scoped.set(span.path, LOG_PATH_RE.test(span.path) ? relevantLogText(question, span.text) : span.text);
  }
  return scoped;
}

function anchorSupported(scoped: Map<string, string>, path: string | undefined, anchor: string): boolean {
  if (path) return scoped.get(path)?.includes(`^${anchor}`) ?? false;
  return [...scoped.values()].some((text) => text.includes(`^${anchor}`));
}

function sanitizeAnchors(text: string, scoped: Map<string, string>): string {
  let sanitized = text.replace(
    /\[([^\]]+)]\(([^)]*?(Log\/(\d{4}-\d{2}-\d{2})\.md)#\^(e-[0-9a-f]{6})[^)]*)\)/gi,
    (match, _label: string, _url: string, path: string, _date: string, anchor: string) =>
      anchorSupported(scoped, path, anchor) ? match : "",
  );
  sanitized = sanitized.replace(
    /\[\[(?:Log\/)?(\d{4}-\d{2}-\d{2})(?:\.md)?#\^(e-[0-9a-f]{6})]]/gi,
    (match, date: string, anchor: string) =>
      anchorSupported(scoped, `Log/${date}.md`, anchor) ? match : "",
  );
  sanitized = sanitized.replace(
    /Log\/(\d{4}-\d{2}-\d{2})\.md#\^(e-[0-9a-f]{6})/gi,
    (match, date: string, anchor: string) =>
      anchorSupported(scoped, `Log/${date}.md`, anchor) ? match : "",
  );
  return sanitized
    .replace(EVIDENCE_ANCHOR_RE, (match, anchor: string) =>
      anchorSupported(scoped, undefined, anchor) ? match : "",
    )
    .replace(/\(\s*\)/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeUnsupportedLiteral(text: string, literal: string): string {
  const escaped = escapeRegExp(literal);
  return text
    .replace(new RegExp(`,?\\s+(?:and|or)\\s+${escaped}\\b`, "g"), "")
    .replace(new RegExp(`\\b${escaped}\\b\\s*,?\\s*(?:and|or)\\s+`, "g"), "")
    .replace(new RegExp(`\\b${escaped}\\b`, "g"), "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:]){2,}/g, "$1");
}

function sanitizeExactLiterals(text: string, corpus: string): string {
  const unsupported = exactLiterals(text).filter((literal) => !corpus.includes(literal));
  if (unsupported.length === 0) return text;

  return text
    .split(/(?<=[.!?])(?=\s|$)|\n/)
    .map((segment) => {
      let next = segment;
      for (const literal of unsupported) next = removeUnsupportedLiteral(next, literal);
      const cleaned = next.trim();
      if (!cleaned) return "";
      if (/\b(?:is|was|are|were|uses?|has|called|named|equals?)\s*[.:!?]?$/i.test(cleaned)) return "";
      if (/^[-*]\s*(?:is|was|are|were)?\s*[.:!?]?$/i.test(cleaned)) return "";
      return cleaned;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Remove exact claims that cannot be grounded in the spans read for this ask turn.
 * Daily logs are narrowed to entries matching the question so a distractor elsewhere
 * in the same file cannot validate an invented answer.
 */
export function sanitizeGroundedAnswer(input: {
  question: string;
  text: string;
  readSpans: ReadSpan[];
  /** Exact host-resolved evidence blocks that bypass question-term narrowing. */
  pinnedSpans?: ReadSpan[];
}): string {
  const scoped = scopedSources(input.question, input.readSpans);
  for (const span of input.pinnedSpans ?? []) {
    const existing = scoped.get(span.path);
    scoped.set(span.path, existing ? `${existing}\n\n${span.text}` : span.text);
  }
  const corpus = [...scoped.values()].join("\n");
  const withoutInvalidAnchors = sanitizeAnchors(input.text, scoped);
  const sanitized = sanitizeExactLiterals(withoutInvalidAnchors, corpus).trim();
  return sanitized || "I couldn't verify that exact detail from the sources read for this question.";
}

const MUTATION_SUCCESS_LANGUAGE_RE = /\b(?:saved|sent|posted|done)\b/i;

/** D15: a read-only answer has no mutation receipt, so it cannot claim success. */
export function sanitizeReadOnlyAnswerText(text: string): string {
  if (!MUTATION_SUCCESS_LANGUAGE_RE.test(text)) return text;
  return "I couldn't return that draft because it contained an unverified action claim. ask_brain is read-only.";
}
