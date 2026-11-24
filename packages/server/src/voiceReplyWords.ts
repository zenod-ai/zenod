/**
 * E7-S35: the words a voice note gets back on WhatsApp. Jordi (24 Nov 2026): "I get a lot of long messages that I find a
 * bit annoying ... if I want to access the full transcript just give me a link". Every reply is one short line; the
 * saved reply carries a link that opens the note's full text in the Zenod app (signed in as the owner, never public).
 */

const DEFAULT_ENTRY_LINK_BASE = "https://cloud.zenod.dev";

/** The app origin the entry link opens: PHYLAX_ENTRY_LINK_BASE, else the hosted Zenod app. */
export function entryLinkBase(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PHYLAX_ENTRY_LINK_BASE?.trim();
  if (configured && /^https?:\/\/[^\s]+$/i.test(configured)) return configured.replace(/\/+$/, "");
  return DEFAULT_ENTRY_LINK_BASE;
}

/** The app link that opens one captured note (`Log/2026-11-24.md#^e-…`) in the memory view; null without a ref. */
export function entryLink(evidenceRef: string | null | undefined, base: string = entryLinkBase()): string | null {
  const ref = evidenceRef?.trim();
  if (!ref) return null;
  return `${base}/#memory?path=${encodeURIComponent(ref)}`;
}

/** The entry link inside a reply already built, so a reply that heads it can keep it on its one line. */
export function entryLinkIn(text: string | null | undefined): string | null {
  return text?.match(/https?:\/\/\S+\/#memory\?path=\S+/)?.[0] ?? null;
}

/** Sent at once for a short voice note. */
export const VOICE_RECEIVED_REPLY = "Got it, on it.";

/** Sent when a voice note is still being processed after the progress delay. */
export const VOICE_STILL_WORKING_REPLY = "Still on it.";

/** Sent at once for a long voice note: the minutes to wait. */
export function voiceLongNoteReply(minutes: number): string {
  return `Got it, long note, about ${Math.max(1, Math.round(minutes))} min.`;
}

/** Sent at once for a note over the transcription limit. */
export function voiceOverLimitReply(limitWords: string): string {
  return `Got it. Over ${limitWords}, so the audio is saved, not transcribed.`;
}

/** The saved reply: one line, the link to the full text (a voice note) or to the note (anything else) when there is one. */
export function voiceSavedReply(link: string | null, transcribed = true): string {
  return link ? `Saved ✓ ${transcribed ? "Full text" : "Open"}: ${link}` : "Saved ✓";
}

/** The saved reply for a note archived without a transcript (over the limit). */
export function voiceArchivedReply(limitWords: string, link: string | null): string {
  return `Audio saved, not transcribed (over ${limitWords}).${link ? ` Note: ${link}` : ""}`;
}

/** Sent when a transcription failed and will be tried again by itself. */
export function voiceRetryReply(failedWords: string, code: string, when: string): string {
  return `⚠️ Not transcribed yet: ${failedWords} (${code}). Audio kept, retrying in ${when}.`;
}

/** Heads the saved reply when a note is filed as not transcribed. */
export function voiceNotTranscribedLine(failedWords: string, code: string, link: string | null): string {
  return `⚠️ Not transcribed: ${failedWords} (${code}). Audio kept.${link ? ` Note: ${link}` : ""}`;
}

/** Sent when the transcript came back empty. */
export const VOICE_EMPTY_TRANSCRIPT_REPLY = "⚠️ Not transcribed: the transcript came back empty. Audio kept.";
