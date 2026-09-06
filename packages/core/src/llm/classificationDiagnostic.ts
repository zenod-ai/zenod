/** Operator diagnostics: fixed vocabulary only, never provider prose or memory values. */
const FIELDS = new Set("topics topic facts key statement effectiveDate effectiveDateQuote correctionQuote supersedesQuotes verificationQuote evidenceQuotes confidence disposition pages path action title aliases name evidenceQuote summary question tags".split(" "));
const CODES = new Set("invalid_type invalid_value invalid_union invalid_key invalid_element invalid_format too_big too_small not_multiple_of unrecognized_keys custom invalid_enum_value invalid_literal invalid_string invalid_date invalid_intersection_types not_finite".split(" "));
const KINDS = new Set(["AI_NoObjectGeneratedError", "AI_TypeValidationError", "AI_JSONParseError", "ZodError", "SyntaxError", "AI_APICallError", "AI_RetryError"]);
const FINISH = new Set(["stop", "length", "content-filter", "tool-calls", "error", "other", "unknown"]);
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;

export function classificationDiagnostic(error: unknown): { finishReason: string; causes: string[]; issues: Array<{ code: string; path: string }> } {
  const root = record(error);
  const finishReason = typeof root?.finishReason === "string" && FINISH.has(root.finishReason) ? root.finishReason : "unknown";
  const causes: string[] = [];
  const issues: Array<{ code: string; path: string }> = [];
  const visited = new Set<unknown>();
  let current = root;
  while (current && causes.length < 5 && !visited.has(current)) {
    visited.add(current);
    causes.push(typeof current.name === "string" && KINDS.has(current.name) ? current.name : "other");
    if (Array.isArray(current.issues)) {
      for (const item of current.issues.slice(0, 8 - issues.length)) {
        const issue = record(item);
        if (!issue) continue;
        const code = typeof issue.code === "string" && CODES.has(issue.code) ? issue.code : "other";
        const path = Array.isArray(issue.path) ? issue.path.slice(0, 8).map(part =>
          typeof part === "string" && FIELDS.has(part) ? part : typeof part === "number" && Number.isInteger(part) && part >= 0 ? "[]" : "[redacted]"
        ).join(".") : "";
        issues.push({ code, path });
      }
    }
    current = record(current.cause);
  }
  return { finishReason, causes, issues };
}
