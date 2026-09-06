import { describe, expect, it } from "vitest";
import { suppressIncompleteAbsence, sanitizeGroundedAnswer } from "../src/engine/answerGrounding.js";

describe("incomplete evidence absence clauses", () => {
  it("preserves quoted historical wording and positive clauses", () => {
    const quoted = 'The saved report says "I couldn’t find deployment receipt".';
    expect(suppressIncompleteAbsence(quoted)).toEqual({ text: quoted, suppressed: false });
    expect(sanitizeGroundedAnswer({ question: "What did the receipt report say?", text: suppressIncompleteAbsence(quoted).text,
      readSpans: [{ path: "Notes/Receipt.md", text: quoted }], pinnedSpans: [] })).toBe(quoted);
    const mixed = "I couldn't find the receipt; the saved preference is keep undo easy.";
    expect(suppressIncompleteAbsence(mixed)).toEqual({ text: "the saved preference is keep undo easy.", suppressed: true });
    expect(suppressIncompleteAbsence("No matching source found. The only evidence is a near-empty header.")).toEqual({ text: "", suppressed: true });
  });
});
