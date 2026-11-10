// The zenod.dev/testers apply form (ZAL-A13): posts to the server, which keeps
// answers in a private file on the production data volume and (EPIC-26 S2)
// accepts the first ten automatically, each mailed a personal link.
export const TESTERS_APPLY_PATH = "/api/public/testers/apply";
export const TESTERS_QUESTION = "How are you going to be using Zenod Memory?";

export type TesterApplyStatus = "accepted" | "waitlist" | null;

/** EPIC-26 S2: the server answers accepted (first ten, link by email) or waitlist. */
export async function submitTesterApplication(
  input: { use: string; contact: string; website: string },
  fetcher: typeof fetch = fetch,
): Promise<TesterApplyStatus> {
  const response = await fetcher(TESTERS_APPLY_PATH, {
    method: "POST",
    credentials: "omit",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown; status?: unknown };
  if (response.ok) return payload.status === "accepted" || payload.status === "waitlist" ? payload.status : null;
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
