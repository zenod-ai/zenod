import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One limits model for a tenant's monthly AI allowance (EPIC-14 S10): what each feature may spend,
 * and what happens near and at each cap. Every cap lives here; personas, the memory desk, calls,
 * chat answers and filing read it. No runtime imports: this file is bundled into Phylax too.
 *
 * The rules, in the order a month runs:
 * - Filing (keeping and organising what you send) never stops at the allowance. It keeps running
 *   up to the allowance plus `filingOverdraftUsd`, a misuse guard; past that the words and files
 *   are still kept raw and filed after the reset. Capture is always kept.
 * - Chat answers run until the whole allowance is used, then say so; anything you sent is kept.
 * - Personas, desk jobs and calls each have their own monthly share, and all three pause once
 *   less than `reserveUsd` of the allowance is left, so the end of the month stays for filing
 *   and answers. Personas pause quietly, the desk and calls refuse with a clear message.
 *
 * Configurable in one place: ZENOD_LIMITS_JSON (a partial override of DEFAULT_LIMITS), with the
 * allowance itself from ZENOD_TENANT_MONTHLY_ALLOWANCE_USD as before.
 */

export type UsageFeature = "filing" | "chat" | "personas" | "desk" | "calls";
export const USAGE_FEATURES: readonly UsageFeature[] = ["filing", "chat", "personas", "desk", "calls"];

export interface ZenodLimits {
  /** Percent of the allowance at which a feature reads "near its cap". */
  warnPercent: number;
  /** Personas, desk jobs and calls pause when less than this much of the allowance is left. */
  reserveUsd: number;
  /** Filing keeps running this far past the allowance before it keeps captures raw only. */
  filingOverdraftUsd: number;
  personas: { monthUsd: number };
  desk: { monthUsd: number; jobsPerDay: number };
  calls: { monthUsd: number; callUsd: number; callMaxMinutes: number; allAccountsMonthUsd: number };
}

export const DEFAULT_LIMITS: ZenodLimits = {
  warnPercent: 80,
  reserveUsd: 0.5,
  filingOverdraftUsd: 3,
  personas: { monthUsd: 1 },
  desk: { monthUsd: 0.5, jobsPerDay: 20 },
  calls: { monthUsd: 1, callUsd: 0.5, callMaxMinutes: 10, allAccountsMonthUsd: 10 },
};

const positive = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;

/** DEFAULT_LIMITS with any valid numbers from ZENOD_LIMITS_JSON laid over it; bad input is ignored. */
export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): ZenodLimits {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = env.ZENOD_LIMITS_JSON ? JSON.parse(env.ZENOD_LIMITS_JSON) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    console.warn("[limits] ZENOD_LIMITS_JSON is not valid JSON; using the defaults");
  }
  const part = (key: string) => (raw[key] && typeof raw[key] === "object" ? raw[key] as Record<string, unknown> : {});
  const d = DEFAULT_LIMITS;
  return {
    warnPercent: positive(raw.warnPercent, d.warnPercent),
    reserveUsd: positive(raw.reserveUsd, d.reserveUsd),
    filingOverdraftUsd: positive(raw.filingOverdraftUsd, d.filingOverdraftUsd),
    personas: { monthUsd: positive(part("personas").monthUsd, d.personas.monthUsd) },
    desk: {
      monthUsd: positive(part("desk").monthUsd, d.desk.monthUsd),
      jobsPerDay: Math.floor(positive(part("desk").jobsPerDay, d.desk.jobsPerDay)),
    },
    calls: {
      monthUsd: positive(part("calls").monthUsd, d.calls.monthUsd),
      callUsd: positive(part("calls").callUsd, d.calls.callUsd),
      callMaxMinutes: positive(part("calls").callMaxMinutes, d.calls.callMaxMinutes),
      allAccountsMonthUsd: positive(part("calls").allAccountsMonthUsd, d.calls.allAccountsMonthUsd),
    },
  };
}

let current: ZenodLimits | null = null;
/** The process's limits, read from the environment once. */
export function zenodLimits(): ZenodLimits {
  current ??= limitsFromEnv();
  return current;
}
/** Tests only: replace (or with null, re-read) the process's limits. */
export function setZenodLimitsForTest(limits: ZenodLimits | null): void {
  current = limits;
}

/** The feature an LLM call is spent on when no feature context is set: by its engine operation. */
export function featureForOperation(operation: string): UsageFeature {
  if (operation === "call") return "calls";
  if (operation === "answer" || operation === "turnPlan") return "chat";
  if (operation === "work") return "desk";
  return "filing";
}

const featureContext = new AsyncLocalStorage<UsageFeature>();
/** Run `fn` with every model call inside it counted (and capped) as `feature`. */
export function withFeature<T>(feature: UsageFeature, fn: () => T): T {
  return featureContext.run(feature, fn);
}
/** The feature the current async context spends on, if one was set. */
export function currentFeature(): UsageFeature | undefined {
  return featureContext.getStore();
}

/** A feature's own monthly share; null = no share of its own (filing, chat: the allowance). */
export function featureShareUsd(feature: UsageFeature, limits: ZenodLimits = zenodLimits()): number | null {
  if (feature === "personas") return limits.personas.monthUsd;
  if (feature === "desk") return limits.desk.monthUsd;
  if (feature === "calls") return limits.calls.monthUsd;
  return null;
}

/** Where a feature stops against the whole allowance (USD spent by all features together). */
export function featureStopAtUsd(feature: UsageFeature, allowanceUsd: number, limits: ZenodLimits = zenodLimits()): number {
  if (feature === "filing") return allowanceUsd + limits.filingOverdraftUsd;
  if (feature === "chat") return allowanceUsd;
  return Math.max(0, allowanceUsd - limits.reserveUsd);
}

export type FeatureState = "ok" | "near" | "paused";

export interface FeatureDecision {
  state: FeatureState;
  /** Why it is paused: the allowance (or its reserve), or the feature's own share. */
  reason?: "allowance" | "share";
  /** What the user is told, in plain words, when it is near or paused. */
  message?: string;
}

const money = (usd: number) => `$${usd.toFixed(2)}`;

function resetLabel(resetsAt: string | null): string {
  if (!resetsAt) return "next month";
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return "next month";
  return `on ${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}`;
}

/** What a paused feature says. Filing and chat promise that captures are kept, because they are. */
export function pausedMessage(feature: UsageFeature, reason: "allowance" | "share", resetsAt: string | null, limits: ZenodLimits = zenodLimits()): string {
  const reset = resetLabel(resetsAt);
  switch (feature) {
    case "filing":
      return `You have used well over this month's AI allowance, so new notes are kept as you sent them, without sorting into topics, until the reset ${reset}.`;
    case "chat":
      return `You have used this month's AI allowance, so I can't answer questions until the reset ${reset}. Everything you send is still kept.`;
    case "personas":
      return reason === "share"
        ? `Helpers have used their ${money(limits.personas.monthUsd)} for this month. They wake again ${reset}.`
        : `Helpers are paused to keep the rest of this month's AI allowance for your notes and answers. They wake again ${reset}.`;
    case "desk":
      return reason === "share"
        ? `The memory desk has used its ${money(limits.desk.monthUsd)} for this month. It takes jobs again ${reset}.`
        : `The memory desk is paused to keep the rest of this month's AI allowance for your notes and answers. It takes jobs again ${reset}.`;
    case "calls":
      return reason === "share"
        ? `This month's calls have reached their ${money(limits.calls.monthUsd)} limit. Calls open again ${reset}.`
        : `Calls are paused to keep the rest of this month's AI allowance for your notes and answers. Calls open again ${reset}.`;
  }
}

/**
 * Near or at the cap, for one feature: `totalUsd` is the whole month's spend, `featureUsd` this
 * feature's. With no allowance set only the feature's own share applies.
 */
export function featureDecision(
  feature: UsageFeature,
  input: { totalUsd: number; featureUsd: number; allowanceUsd: number | null; resetsAt: string | null },
  limits: ZenodLimits = zenodLimits(),
): FeatureDecision {
  const share = featureShareUsd(feature, limits);
  if (share !== null && input.featureUsd >= share) {
    return { state: "paused", reason: "share", message: pausedMessage(feature, "share", input.resetsAt, limits) };
  }
  if (input.allowanceUsd !== null && input.allowanceUsd > 0) {
    const stopAt = featureStopAtUsd(feature, input.allowanceUsd, limits);
    if (input.totalUsd >= stopAt) {
      return { state: "paused", reason: "allowance", message: pausedMessage(feature, "allowance", input.resetsAt, limits) };
    }
    if (input.totalUsd >= Math.min(stopAt, input.allowanceUsd) * (limits.warnPercent / 100)) {
      return { state: "near", message: nearMessage(feature) };
    }
  }
  if (share !== null && share > 0 && input.featureUsd >= share * (limits.warnPercent / 100)) {
    return { state: "near", message: nearMessage(feature) };
  }
  return { state: "ok" };
}

function nearMessage(feature: UsageFeature): string {
  switch (feature) {
    case "filing": return "Most of this month's allowance is used. Filing carries on: your notes are always kept.";
    case "chat": return "Most of this month's allowance is used. Answers stop when it runs out; your notes are still kept.";
    case "personas": return "Helpers will pause soon to keep the rest of the month for your notes and answers.";
    case "desk": return "The desk will pause soon to keep the rest of the month for your notes and answers.";
    case "calls": return "Calls will pause soon to keep the rest of the month for your notes and answers.";
  }
}

/** Plain words for the Usage section: what each feature is, what it costs, what happens at its cap. */
export const FEATURE_INFO: Record<UsageFeature, { label: string; costs: string; atCap: string }> = {
  filing: {
    label: "Filing your notes",
    costs: "About 1 cent per note in a small memory, up to 5 cents in a large one. A one-minute voice note costs about a third of a cent to transcribe.",
    atCap: "Never stops at the allowance. Only far past it are new notes kept as sent, without sorting, until the reset.",
  },
  chat: {
    label: "Chat answers",
    costs: "About a fifth of a cent per answer, about 1 cent for a deeper question.",
    atCap: "Stops when the allowance is used. What you send is still kept.",
  },
  personas: {
    label: "Helpers",
    costs: "Under 1 cent for most runs, up to 2 cents for a weekly recap.",
    atCap: "Pause quietly at their own monthly share, or when the allowance is nearly used.",
  },
  desk: {
    label: "Memory desk jobs",
    costs: "Less than 1 cent per job.",
    atCap: "Says it is paused at its monthly share or when the allowance is nearly used, and takes jobs again after the reset.",
  },
  calls: {
    label: "Calls",
    costs: "About 2 to 3 cents a minute for questions and answers, more for long talks. One call stops at 10 minutes or 50 cents.",
    atCap: "Refuses a new call with the reason at its monthly share or when the allowance is nearly used.",
  },
};

export interface UsageFeatureView {
  id: UsageFeature;
  label: string;
  spentUsd: number;
  /** The feature's own monthly share, or null when it only has the allowance. */
  shareUsd: number | null;
  /** Total month spend at which this feature stops (null: no allowance set). */
  stopsAtUsd: number | null;
  state: FeatureState;
  message: string | null;
  costs: string;
  atCap: string;
}

export interface UsageView {
  allowanceUsd: number | null;
  spentUsd: number;
  percentageUsed: number | null;
  resetsAt: string;
  reserveUsd: number;
  features: UsageFeatureView[];
}

/** This month's spend by feature against the allowance and each feature's own share. */
export function usageView(
  input: { byFeature: Partial<Record<UsageFeature, number>>; allowanceUsd: number | null; resetsAt: string; totalUsd?: number },
  limits: ZenodLimits = zenodLimits(),
): UsageView {
  const spend = (feature: UsageFeature) => input.byFeature[feature] ?? 0;
  const totalUsd = input.totalUsd ?? USAGE_FEATURES.reduce((sum, feature) => sum + spend(feature), 0);
  const allowance = input.allowanceUsd !== null && input.allowanceUsd > 0 ? input.allowanceUsd : null;
  return {
    allowanceUsd: allowance,
    spentUsd: totalUsd,
    percentageUsed: allowance === null ? null : Math.min(100, Math.round((totalUsd / allowance) * 100)),
    resetsAt: input.resetsAt,
    reserveUsd: limits.reserveUsd,
    features: USAGE_FEATURES.map((feature) => {
      const decision = featureDecision(feature, { totalUsd, featureUsd: spend(feature), allowanceUsd: allowance, resetsAt: input.resetsAt }, limits);
      return {
        id: feature,
        label: FEATURE_INFO[feature].label,
        spentUsd: spend(feature),
        shareUsd: featureShareUsd(feature, limits),
        stopsAtUsd: allowance === null ? null : featureStopAtUsd(feature, allowance, limits),
        state: decision.state,
        message: decision.message ?? null,
        costs: FEATURE_INFO[feature].costs,
        atCap: FEATURE_INFO[feature].atCap,
      };
    }),
  };
}
