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
});
