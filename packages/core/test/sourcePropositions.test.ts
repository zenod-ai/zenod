import { describe, expect, it } from "vitest";
import { resolveTopicSpans, sourceWindows } from "../src/engine/sourcePassages.js";
import type { ClassificationTopic } from "../src/llm/types.js";

function resolve(content: string, quote: string, semanticRange = { start: 0, end: content.length }) {
  const window = sourceWindows({ content, semanticRange }).find(w => w.passages.some(p => p.text.includes(quote)))!;
  const passage = window.passages.find(p => p.text.includes(quote))!;
  const topic: ClassificationTopic = { topic: "independent idea", summary: "independent idea", confidence: 0.95,
    disposition: "append_compact_note", pages: [], evidenceQuotes: [], sourceRange: window.range,
    sourcePassages: window.passages, evidenceAssignments: [{ passageId: passage.id, quote, occurrence: 0 }] };
  const resolved = resolveTopicSpans(content, topic, { completePropositions: true, semanticRange });
  return { ...resolved, spans: resolved.supportSpans ?? resolved.spans, topic };
}

describe("complete exact source propositions", () => {
  it.each([
    ["For Vega, each visitor should receive a reusable guide printed on waterproof paper.", "reusable guide printed on waterproof paper"],
    ["Elisa debe entregar una tarjeta reutilizable a cada visitante, excepto a los adultos.", "tarjeta reutilizable"],
    ["It is false that we repair batteries; only the frame is serviced.", "we repair batteries"],
    ["A collaborator reports Friday for Vega. I have not confirmed that claim and am not changing our agreed Thursday.", "Friday for Vega"],
    ["Hypothesis: a rope display might improve learning. This has not been verified.", "rope display might improve learning"],
  ])("retains actor/predicate/qualifiers around %s", (content, quote) => {
    const result = resolve(content, quote);
    expect(result.invalid).toBe(false);
    expect(result.spans.map(s => content.slice(s.start, s.end)).join("\n")).toBe(content);
  });

  it("excludes media wrappers while preserving source CRLF and Unicode", () => {
    const prefix = "Source: transport metadata\r\n";
    const transcript = "Cada visitante recibirá una guía 🌌.\r\nNo es una entrega confirmada.  ";
    const content = prefix + transcript;
    const result = resolve(content, "guía 🌌", { start: prefix.length, end: content.length });
    expect(result.invalid).toBe(false);
    expect(content.slice(result.spans[0]!.start, result.spans[0]!.end)).toBe(transcript);
    expect(result.spans[0]!.start).toBe(prefix.length);
  });
  it("keeps original quote identity separate from expanded shared paragraph context", () => {
    const content = "Each visitor gets a reusable guide. Each teacher gets a pen.";
    const first = resolve(content, "reusable guide");
    const second = resolve(content, "a pen");
    expect(first.spans).toEqual(second.spans);
    const identity = resolveTopicSpans(content, first.topic, { completePropositions: true });
    expect(identity.spans.map(s => content.slice(s.start, s.end))).toEqual(["reusable guide"]);
    expect(identity.supportSpans!.map(s => content.slice(s.start, s.end))).toEqual([content]);
  });

  it("retains adjacent qualification in continuous ASR without copying an unbounded transcript", () => {
    const padding = "The ambient room is quiet. ".repeat(180);
    const claim = "A collaborator suggests Friday. That is unconfirmed and does not replace Thursday. ";
    const content = padding + claim + padding;
    const result = resolve(content, "suggests Friday");
    expect(result.invalid).toBe(false);
    const support = result.spans.map(s => content.slice(s.start, s.end)).join("");
    expect(support).toContain(claim);
    expect(support.length).toBeLessThan(3200);
  });

  it("defers an unbroken sentence beyond the context budget", () => {
    const content = "The claim " + "and ".repeat(1000) + "is unconfirmed.";
    expect(resolve(content, "The claim").invalid).toBe(true);
  });

  it.each(["cut", "gap"])("rejects missing true qualifier boundaries in supplied passages (%s)", mode => {
    const content = "It is false that we repair batteries. This report is unconfirmed.";
    const original = resolve(content, "we repair batteries");
    const start = content.indexOf("we repair");
    const end = content.indexOf(". This");
    const part = { id: "provided", start, end, text: content.slice(start, end) };
    const topic = { ...original.topic, sourcePassages: mode === "cut" ? [part] : [
      { id: "prefix", start: 0, end: start - 1, text: content.slice(0, start - 1) }, part,
      { id: "suffix", start: end, end: content.length, text: content.slice(end) }],
      evidenceAssignments: [{ passageId: part.id, quote: part.text, occurrence: 0 }] };
    expect(resolveTopicSpans(content, topic).invalid).toBe(false);
    expect(resolveTopicSpans(content, topic, { completePropositions: true }).invalid).toBe(true);
  });

  it("distinguishes valid neighbor-only context from malformed assignments without rescuing ownership", () => {
    const content = "Owner receives a guide. Another idea stays here.";
    const { topic } = resolve(content, "receives a guide");
    topic.sourceRange = { start: content.indexOf("Another"), end: content.length };
    const neighbor = resolveTopicSpans(content, topic, { completePropositions: true });
    expect(neighbor.invalid).toBe(true);
    expect(neighbor.nonOwnedContext).toBe(true);
    expect(neighbor.supportSpans).toBeUndefined();
    const malformed = resolveTopicSpans(content, { ...topic, evidenceAssignments: [
      ...topic.evidenceAssignments!, { passageId: "unknown", quote: "Another idea", occurrence: 0 }] });
    expect(malformed.invalid).toBe(true);
    expect(malformed.nonOwnedContext).toBe(false);
  });

});
