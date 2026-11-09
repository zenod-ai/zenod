import { isLlmAllowanceExceededError } from "./aisdk.js";
import type { BrainLlm } from "./types.js";

/**
 * Background route (EPIC-14 S10 round 4): filing and desk work go to a second, cheaper model
 * (DeepSeek's own API) while answers, chat, image description and calls stay on the primary
 * route (OpenRouter). Any failure on the background route other than a used-up AI allowance
 * repeats the same call on the primary route, so nothing a user sends is lost. A failure that
 * means the account itself is unusable (no balance, bad key) parks the background route for a
 * cool-down so every job does not pay for a failed call first.
 */
export interface BackgroundRouteOptions {
  /** Route filing (classify, compose, reconcile, backlog extraction) to the background model. */
  filing: boolean;
  /** Route desk work (the librarian work loop) to the background model. */
  desk: boolean;
  /** How long the background route is skipped after a balance or key failure. Default 10 minutes. */
  cooldownMs?: number;
  now?: () => number;
  /** Told about every fall back to the primary route; must not throw. */
  onFallback?: (event: { method: string; status: number | null; parked: boolean }) => void;
}

const FILING_METHODS = new Set(["classify", "composePage", "reconcile", "extractBacklog"]);
const DESK_METHODS = new Set(["work"]);
/** 401 bad key, 402 no balance, 403 refused: the account cannot serve any call until a human acts. */
const ACCOUNT_STATUSES = new Set([401, 402, 403]);

/** The provider's HTTP status, also when a filing step wrapped the provider error as its cause. */
function statusOf(error: unknown): number | null {
  let current = error as { statusCode?: unknown; status?: unknown; cause?: unknown } | null | undefined;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const status = current.statusCode ?? current.status;
    if (typeof status === "number") return status;
    current = current.cause as typeof current;
  }
  return null;
}

export function withBackgroundRoute(primary: BrainLlm, background: BrainLlm, options: BackgroundRouteOptions): BrainLlm {
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? 10 * 60_000;
  let parkedUntil = 0;
  const routed = (method: string) => (options.filing && FILING_METHODS.has(method)) || (options.desk && DESK_METHODS.has(method));

  const call = (method: string) => async (...args: unknown[]) => {
    const onPrimary = () => (primary as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!.apply(primary, args);
    if (now() < parkedUntil) return onPrimary();
    try {
      return await (background as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!.apply(background, args);
    } catch (error) {
      if (isLlmAllowanceExceededError(error)) throw error;
      const status = statusOf(error);
      const parked = status !== null && ACCOUNT_STATUSES.has(status);
      if (parked) parkedUntil = now() + cooldownMs;
      try { options.onFallback?.({ method, status, parked }); } catch { /* telemetry never breaks a job */ }
      return onPrimary();
    }
  };

  // The desk agent's streamed calls (EPIC-14 S11): background when desk is routed, else the chat model.
  const backgroundChat = async (input: { system: string; prompt: string }, onText: (delta: string) => void): Promise<string> => {
    const onPrimary = () => primary.streamMemoryChat!(input, onText);
    if (!options.desk || !background.streamMemoryChat || now() < parkedUntil) return onPrimary();
    try {
      return await background.streamMemoryChat(input, onText);
    } catch (error) {
      if (isLlmAllowanceExceededError(error)) throw error;
      const status = statusOf(error);
      const parked = status !== null && ACCOUNT_STATUSES.has(status);
      if (parked) parkedUntil = now() + cooldownMs;
      try { options.onFallback?.({ method: "streamBackgroundChat", status, parked }); } catch { /* telemetry never breaks a job */ }
      return onPrimary();
    }
  };

  // Proxy preserves every other BrainLlm method (answers, chat, turn plans) on the primary route.
  return new Proxy(primary, {
    get(target, property, receiver) {
      if (property === "streamBackgroundChat") return primary.streamMemoryChat ? backgroundChat : undefined;
      if (typeof property === "string" && routed(property) && typeof (background as unknown as Record<string, unknown>)[property] === "function") {
        return call(property);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
