import type { BrainEngine } from "zenod";

export type ArtifactKind = "image" | "pdf" | "text" | "google_doc" | "audio";

export interface ArtifactExtractionResult {
  body: string;
  provider: string | null;
  kind: ArtifactKind;
}

const PDF_TEXT_TOKEN = /\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>/g;
const PDF_TEXT_OPERATORS = /\b(?:Tj|TJ|'|")\b/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function isPdfMimeType(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

export function isExtractableArtifactMimeType(mimeType: string): boolean {
  return isImageMimeType(mimeType) || isPdfMimeType(mimeType);
}

function decodePdfLiteral(raw: string): string {
  return raw
    .slice(1, -1)
    .replace(/\\([nrtbf()\\])/g, (_match, ch: string) => {
      switch (ch) {
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "t":
          return "\t";
        case "b":
          return "\b";
        case "f":
          return "\f";
        default:
          return ch;
      }
    })
    .replace(/\\([0-7]{1,3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function decodePdfHex(raw: string): string {
  const hex = raw.replace(/[<>\s]/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < hex.length - 1; i += 2) bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  return Buffer.from(bytes).toString("utf8");
}

export function extractTextFromPdf(data: Buffer): string {
  const raw = data.toString("latin1");
  const chunks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = PDF_TEXT_TOKEN.exec(raw))) {
    const nearby = raw.slice(match.index, Math.min(raw.length, match.index + 240));
    if (!PDF_TEXT_OPERATORS.test(nearby)) continue;
    const token = match[0]!;
    const decoded = token.startsWith("(") ? decodePdfLiteral(token) : decodePdfHex(token);
    const cleaned = decoded.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length >= 2) chunks.push(cleaned);
  }
  return chunks.join("\n").trim();
}

export async function extractArtifact(input: {
  data: Buffer;
  fileName: string;
  mimeType: string;
  engine: BrainEngine;
}): Promise<ArtifactExtractionResult> {
  if (isPdfMimeType(input.mimeType)) {
    const text = extractTextFromPdf(input.data);
    if (!text) {
      throw new Error(
        `PDF extraction failed for ${input.fileName}: no embedded text found; scanned PDFs need OCR/vision extraction configured`,
      );
    }
    return {
      kind: "pdf",
      provider: "embedded PDF text",
      body: text,
    };
  }

  if (isImageMimeType(input.mimeType)) {
    if (input.mimeType === "image/svg+xml") {
      const svgText = input.data.toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (svgText) {
        return {
          kind: "image",
          provider: "svg text",
          body: svgText,
        };
      }
    }

    const description = await input.engine.describeImage(
      input.data,
      input.mimeType,
      [
        "Extract durable memory from this screenshot or image.",
        "Return concise plain text with visible text, important facts, labels, dates, amounts, names, and source uncertainty.",
        "Do not invent details that are not visible.",
      ].join(" "),
    );
    const body = description.trim();
    if (!body) throw new Error(`image extraction failed for ${input.fileName}: vision provider returned no text`);
    return {
      kind: "image",
      provider: "vision model",
      body,
    };
  }

  throw new Error(`unsupported file type ${input.mimeType} — audio, text, Google Docs, images, and PDFs are supported`);
}
