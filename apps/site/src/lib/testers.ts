// The zenod.dev/testers apply form (ZAL-A13): posts to the server, which keeps
// answers in a private file on the production data volume and (EPIC-26 S2)
// accepts the first ten automatically. E26-S11 iteration 4 (Jordi, 2026-11-12: "test with
// testers, not with fucking API keys"): each accepted person sees their link on screen, and this
// browser keeps it (plus a private key that fetches it again), so no email is needed.
export const TESTERS_APPLY_PATH = "/api/public/testers/apply";
export const TESTERS_LINK_PATH = "/api/public/testers/link";
export const TESTERS_WITHDRAW_PATH = "/api/public/testers/withdraw";
const STORE_KEY = "zenod.tester";
export const TESTERS_QUESTION = "How are you going to be using Zenod Memory?";

export type TesterApplyStatus = "accepted" | "waitlist" | null;

/** EPIC-23 U7: the answer, with the personal link when the person was accepted just now. */
export interface TesterApplyResult {
  status: TesterApplyStatus;
  link: string | null;
  /** E26-S11 iteration 4: the private key this browser keeps to show the link again. */
  claim?: string | null;
  /** This email applied before: its link shows only in the browser it applied from. */
  again?: boolean;
}

const CLAIM = /^[A-Za-z0-9_-]{20,64}$/;

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
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown; status?: unknown; link?: unknown; claim?: unknown; again?: unknown };
  if (response.ok) {
    const status = payload.status === "accepted" || payload.status === "waitlist" ? payload.status : null;
    const link = status === "accepted" && typeof payload.link === "string" && JOIN_LINK.test(payload.link) ? payload.link : null;
    const result: TesterApplyResult = { status, link };
    if (status === "accepted" && typeof payload.claim === "string" && CLAIM.test(payload.claim)) result.claim = payload.claim;
    if (payload.again === true) result.again = true;
    return result;
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

/** What this browser keeps about its own application: never anyone else's. */
export interface RememberedTester {
  link: string | null;
  claim: string | null;
}

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function forgetTester(store: Store | null = browserStore()): void {
  try {
    (store as Storage | null)?.removeItem?.(STORE_KEY);
  } catch {
    // nothing kept
  }
}

export function rememberTester(value: RememberedTester, store: Store | null = browserStore()): void {
  try {
    store?.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // Private mode or full storage: the link is still on screen.
  }
}

export function rememberedTester(store: Store | null = browserStore()): RememberedTester | null {
  try {
    const raw = store?.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { link?: unknown; claim?: unknown };
    const link = typeof parsed.link === "string" && JOIN_LINK.test(parsed.link) ? parsed.link : null;
    const claim = typeof parsed.claim === "string" && CLAIM.test(parsed.claim) ? parsed.claim : null;
    return link || claim ? { link, claim } : null;
  } catch {
    return null;
  }
}

/** E26-S11 iteration 4: trades this browser's private key for its link; null while the code is still being made. */
export async function fetchTesterLink(claim: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const response = await fetcher(TESTERS_LINK_PATH, {
    method: "POST",
    credentials: "omit",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ claim }),
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => ({}))) as { link?: unknown };
  return typeof payload.link === "string" && JOIN_LINK.test(payload.link) ? payload.link : null;
}

/** E26-S11 iteration 4: withdraws this browser's own application; its code is switched off. */
export async function withdrawTester(claim: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(TESTERS_WITHDRAW_PATH, {
    method: "POST",
    credentials: "omit",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ claim }),
  });
  if (response.ok || response.status === 404) return;
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
  throw new Error(typeof payload.error === "string" ? payload.error : "Could not withdraw just now. Please try again later.");
}
