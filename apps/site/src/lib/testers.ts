// The zenod.dev/testers apply form (ZAL-A13): posts to the server, which keeps
// answers in a private file on the production data volume and (EPIC-26 S2)
// accepts the first ten automatically, each mailed a personal link.
export const TESTERS_APPLY_PATH = "/api/public/testers/apply";
export const TESTERS_QUESTION = "How are you going to be using Zenod Memory?";

export type TesterApplyStatus = "accepted" | "waitlist" | null;

/** EPIC-23 U7: the answer, with the personal link when the person was accepted just now. */
export interface TesterApplyResult {
  status: TesterApplyStatus;
  link: string | null;
}

const JOIN_LINK = /^https:\/\/cloud\.zenod\.dev\/join\?code=[A-Za-z0-9_-]{3,40}$/;

/** EPIC-26 S2: the server answers accepted (first ten) or waitlist; U7: with the link to open now. */
export async function submitTesterApplication(
  input: { use: string; contact: string; website: string },
  fetcher: typeof fetch = fetch,
): Promise<TesterApplyResult> {
  const response = await fetcher(TESTERS_APPLY_PATH, {
    method: "POST",
    credentials: "omit",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown; status?: unknown; link?: unknown };
  if (response.ok) {
    const status = payload.status === "accepted" || payload.status === "waitlist" ? payload.status : null;
    const link = status === "accepted" && typeof payload.link === "string" && JOIN_LINK.test(payload.link) ? payload.link : null;
    return { status, link };
  }
  throw new Error(typeof payload.error === "string" ? payload.error : "Could not send your application. Please try again.");
}

// EPIC-26 T1 round 2: the tester code travels in one link to cloud.zenod.dev/join.
const JOIN_URL = "https://cloud.zenod.dev/join";

/** The tester code in this page's address, if it looks like one. */
export function inviteCodeFromSearch(search: string | undefined): string | null {
  const code = new URLSearchParams(search ?? "").get("code")?.trim() ?? "";
  return /^[A-Za-z0-9_-]{3,40}$/.test(code) ? code : null;
}

export function joinUrl(code: string): string {
  return `${JOIN_URL}?code=${encodeURIComponent(code)}`;
}
