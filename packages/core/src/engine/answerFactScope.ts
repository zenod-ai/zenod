import type { FactView } from "./temporalFacts.js";

// Entity names select a page, not every predicate on that page. This selector is
// intentionally lexical: it narrows optional host rendering, never creates facts
// or establishes semantic equivalence between two assertions.
const STOP = new Set("a an the and or of to in on for from with is are was were be been being has have had do does did not no will would could should may might can about what which when where how current currently now today previous previously prior before after report reports reported memory saved tell me this that these those it its our we their they as at by una un el la los las de del en para por con es son era eran que cual como se lo su sus no si ahora antes actual una".split(" "));
function terms(text: string, path: string): Set<string> {
  const words = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const entity = new Set(words(path.split("/").at(-1)!.replace(/\.md$/, "")));
  return new Set(words(text).filter(word => word.length > 2 && !STOP.has(word) && !entity.has(word)));
}
function overlaps(left: string, right: string, path: string): boolean {
  const lhs = terms(left, path), rhs = terms(right, path);
  return [...lhs].some(word => rhs.has(word));
}

function scopePath(view: FactView): string {
  const groups = [...new Set(view.facts.map(fact => fact.key))].map(key => view.facts.find(fact => fact.key === key)!);
  if (groups.length < 2) return view.path;
  const shared = [...terms(groups[0]!.statement, view.path)].filter(word => groups.every(fact => terms(fact.statement, view.path).has(word)));
  return view.path.replace(/\.md$/, ` ${shared.join(" ")}.md`);
}

/** Retain whole key histories so narrowing cannot discard a conflict or correction. */
export function questionFactViews(question: string, views: FactView[], answerText = ""): FactView[] {
  return views.flatMap(view => {
    // Explicit key selection and incomplete/legacy results retain their warnings.
    if (view.key || view.legacy || !view.complete) return [view];
    const keys = new Set(view.facts.filter(fact => overlaps(question, fact.statement, scopePath(view)) || answerText.includes(fact.statement)).map(fact => fact.key));
    if (!keys.size) return [];
    return [{ ...view, facts: view.facts.filter(fact => keys.has(fact.key)),
      ...(view.priorStatements ? { priorStatements: view.priorStatements.filter(prior => view.facts.some(fact => keys.has(fact.key) && fact.evidenceRef === prior.supersededByEvidenceRef && fact.legacySupersedes?.statementId === prior.statementId && fact.legacySupersedes.path === prior.path)) } : {}) }];
  });
}

/** Supplement temporal rendering only with exact quotations selected in the model
 * answer and independently present in an actually read immutable entry. We do not
 * copy surrounding generated assertions or promote raw reports to current facts.
 * This deliberately falls back to extractive wording, without another model call.
 */
export function rawAnswerQuotations(input: {
  question: string; text: string; views: FactView[];
  evidence: Array<{ ref: string; text: string }>;
}): string {
  const quotes = [...input.text.matchAll(/"([^"\n]{12,1600})"|“([^”\n]{12,1600})”/g)].map(match => (match[1] ?? match[2])!);
  const retained: string[] = [];
  for (const quote of new Set(quotes)) {
    const evidence = input.evidence.find(entry => {
      let start = entry.text.indexOf(quote);
      while (start >= 0) {
        const before = entry.text.slice(0, start), after = entry.text.slice(start + quote.length);
        // A substring inside a negation, hypothetical or attribution is not an
        // independently supported statement. Keep complete source sentences only.
        if ((!before.trim() || /[.!?]\s+$/.test(before))
          && (!after.trim() || (/[.!?]$/.test(quote) && /^\s/.test(after)))) return true;
        start = entry.text.indexOf(quote, start + 1);
      }
      return false;
    });
    if (!evidence) continue;
    if (!overlaps(input.question, quote, "")) continue;
    // Existing structured predicates own their current/prior/conflict rendering.
    if (input.views.some(view => view.facts.some(fact => overlaps(quote, fact.statement, scopePath(view))))) continue;
    retained.push(`- ${JSON.stringify(quote)} (${evidence.ref})`);
  }
  return retained.length ? `Additional raw evidence quotations (reported wording; not independently verified current state):\n${retained.join("\n")}` : "";
}
