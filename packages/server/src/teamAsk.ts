import type { PersonaStore } from "./personaStore.js";
import { signSubscriberEvent, type SubscriberStore } from "./subscribers.js";

/**
 * EPIC-14 S35: a helper may ask the Team desk one question in words a run, read only. The only seam
 * is the one the voice-note webhook already uses (root L-7): the same connection's URL with `/ask`
 * appended, signed with that subscription's own whsec_ secret, exactly as a delivery (agent_team
 * E45-S5). Zenod sends a question and reads an answer; nothing on the team side is picked, filed,
 * dispatched or posted, and Zenod never calls into the console's internals.
 */

export const TEAM_ASK_QUESTION_MAX = 300;
export const TEAM_ASK_ANSWER_MAX = 800;
export const TEAM_ASK_TIMEOUT_MS = 20_000;

export interface TeamAnswer {
  answer: string;
  refs: string[];
  model: string;
  costUsd: number;
}

export interface TeamAsk {
  ask(input: { question: string; helper: string; run: string; test?: boolean }): Promise<TeamAnswer>;
}

/** The team said no (401 bad_signature, 409 one_per_run or replayed, 429 daily_cap, 404) or did not answer. */
export class TeamAskError extends Error {
  constructor(readonly code: string, readonly status: number | null) {
    super(`The team desk did not answer (${code})`);
    this.name = "TeamAskError";
  }
}

const HOOK_PATH = /^\/api\/hooks\/zenod\/([A-Za-z0-9_-]+)\/?$/;

/** `https://hooks.alpha9.io/api/hooks/zenod/zcn_x` gives `.../zcn_x/ask`; any other URL gives null. */
export function teamAskUrl(subscriptionUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(subscriptionUrl);
  } catch {
    return null;
  }
  const match = HOOK_PATH.exec(url.pathname);
  if (!match || url.search || url.hash) return null;
  url.pathname = `/api/hooks/zenod/${match[1]}/ask`;
  return url.toString();
}

/** The tenant's switched-on Team connection that can take a question, or null. */
export function teamAskSubscription(store: SubscriberStore): { id: string; askUrl: string; createdAt: string } | null {
  for (const sub of store.list()) {
    if (!sub.enabled || sub.kind !== "agent_team") continue;
    const askUrl = teamAskUrl(sub.url);
    if (askUrl) return { id: sub.id, askUrl, createdAt: sub.createdAt };
  }
  return null;
}

/** The release that brought asking: accounts already connected to their team before it. */
export const TEAM_ASK_SINCE = "2026-11-10T10:00:00.000Z";
/** The helpers whose suggestions gain from knowing how things connect. */
export const TEAM_ASK_FIRST_HELPERS = ["open-loops", "topic-gardener"] as const;

/**
 * Once, for an account whose Team connection predates asking: switch asking on for those helpers
 * it already has on and whose settings were last changed before the release, so the person's own
 * later choice (on or off) always stands. Everyone else starts with asking off. Returns the ids.
 */
export function switchOnTeamAskForConnected(personas: PersonaStore, subscribers: SubscriberStore | null, since = TEAM_ASK_SINCE): string[] {
  const sub = subscribers ? teamAskSubscription(subscribers) : null;
  if (!sub || sub.createdAt >= since) return [];
  const switched: string[] = [];
  for (const id of TEAM_ASK_FIRST_HELPERS) {
    const changed = personas.settingsUpdatedAt(id);
    if (personas.enabled(id) !== true || personas.askTeam(id) || !changed || changed >= since) continue;
    personas.setAskTeam(id, true, false);
    switched.push(id);
  }
  return switched;
}

export interface TeamAskOptions {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** A TeamAsk over the tenant's Team connection, or null when it has none. */
export function teamAskFor(store: SubscriberStore | null, options: TeamAskOptions = {}): TeamAsk | null {
  if (!store || !teamAskSubscription(store)) return null;
  return {
    async ask({ question, helper, run, test }) {
      const sub = teamAskSubscription(store);
      const secret = sub ? store.signingSecret(sub.id) : null;
      if (!sub || !secret) throw new TeamAskError("no_connection", null);
      const body = JSON.stringify({
        question: question.replace(/\s+/g, " ").trim().slice(0, TEAM_ASK_QUESTION_MAX),
        helper: helper.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 80),
        run: run.slice(0, 120),
        ...(test ? { test: true } : {}),
      });
      const now = options.now ?? Date.now;
      let response: Response;
      try {
        response = await (options.fetch ?? fetch)(sub.askUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Zenod-Helpers/1",
            // Signed fresh per call: the team refuses a replayed signature.
            "x-zenod-signature": signSubscriberEvent(body, secret, Math.floor(now() / 1000)),
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(options.timeoutMs ?? TEAM_ASK_TIMEOUT_MS),
        });
      } catch (error) {
        throw new TeamAskError((error as Error).name === "TimeoutError" ? "timeout" : "unreachable", null);
      }
      const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) throw new TeamAskError(typeof json?.error === "string" ? json.error.slice(0, 40) : `http_${response.status}`, response.status);
      const answer = typeof json?.answer === "string" ? json.answer.replace(/\s+/g, " ").trim().slice(0, TEAM_ASK_ANSWER_MAX) : "";
      if (!answer) throw new TeamAskError("empty", response.status);
      const refs = Array.isArray(json?.refs) ? json.refs.filter((ref): ref is string => typeof ref === "string").map((ref) => ref.slice(0, 120)).slice(0, 8) : [];
      const costUsd = typeof json?.costUsd === "number" && Number.isFinite(json.costUsd) && json.costUsd >= 0 ? json.costUsd : 0;
      return { answer, refs, model: typeof json?.model === "string" ? json.model.slice(0, 60) : "unknown", costUsd };
    },
  };
}
