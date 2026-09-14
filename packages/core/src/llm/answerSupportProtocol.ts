import type { AnswerResult } from "./types.js";
import type { AnswerSupportSelection } from "../engine/answerSupport.js";
const modes = new Set(["current", "historical", "prior", "conflict", "raw_report"]);
/** Decode only the final completion; never expose protocol JSON as prose. */
export function decodeSupportedAnswer(text: string, readPaths: string[], requireSelection = false): AnswerResult {
  const trimmed=text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!requireSelection && !trimmed.includes("supportSelections")) return {text,readPaths};
  try {
    const value=JSON.parse(trimmed);
    if (!value || !Array.isArray(value.supportSelections) || value.supportSelections.length>24) throw new Error("invalid selection");
    const supportSelections: AnswerSupportSelection[] = value.supportSelections.map((item: unknown) => {
      if (!item || typeof item !== "object") throw new Error("invalid selection");
      const {id,mode}=item as Record<string,unknown>;
      if (typeof id!=="string" || !/^as_[a-f0-9]{24}$/.test(id) || typeof mode!=="string" || !modes.has(mode)) throw new Error("invalid selection");
      return {id,mode:mode as AnswerSupportSelection["mode"]};
    });
    // Ignore all generated prose, even with a valid ID: the host owns wording.
    return {text:"",readPaths,supportSelections};
  } catch { return {text:"",readPaths,supportProtocolError:"invalid_submission"}; }
}

export const ANSWER_PROTOCOL_FAILURE_TEXT = "The model did not submit a valid memory-answer selection. Repeat the question; the source evidence was not rejected as invalid.";
