import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * EPIC-20 A4 (decision EPIC-20-A1, 2026-11-19): Phylax transcribes every tenant's voice notes with
 * the team's shared OpenAI key (PHYLAX_SHARED_OPENAI_API_KEY, copied under E14-G1) and stops at a
 * hard monthly cap. The meter counts the estimated cost of every billed OpenAI attempt; once the
 * month's spend reaches the cap, notes go back to the tenant's own configuration (local whisper.cpp
 * in practice) until the UTC month turns. Unset key or PHYLAX_SHARED_STT=0 switches it off.
 */
export const PHYLAX_SHARED_STT_DEFAULT_MODEL = "gpt-4o-mini-transcribe";
export const PHYLAX_SHARED_STT_DEFAULT_CAP_USD = 10;

interface BudgetState {
  month: string;
  spentUsd: number;
  notes: number;
  failures: number;
}

export interface PhylaxSharedTranscriptionRoute {
  key: string;
  model: string;
  record: (entry: { estimatedCostUsd: number; status: "succeeded" | "failed" }) => void;
}

export function utcMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export class PhylaxSharedTranscriptionBudget {
  readonly key: string | null;
  readonly model: string;
  readonly capUsd: number;
  private readonly file: string;
  private readonly now: () => Date;
  private state: BudgetState;

  constructor(dataDir: string, env: NodeJS.ProcessEnv, now: () => Date = () => new Date()) {
    const key = env.PHYLAX_SHARED_OPENAI_API_KEY?.trim();
    this.key = key && env.PHYLAX_SHARED_STT !== "0" ? key : null;
    this.model = env.PHYLAX_SHARED_STT_MODEL?.trim() || PHYLAX_SHARED_STT_DEFAULT_MODEL;
    const cap = Number(env.PHYLAX_SHARED_STT_MONTHLY_USD ?? PHYLAX_SHARED_STT_DEFAULT_CAP_USD);
    this.capUsd = Number.isFinite(cap) && cap >= 0 ? cap : PHYLAX_SHARED_STT_DEFAULT_CAP_USD;
    this.file = join(dataDir, "phylax-shared-transcription.json");
    this.now = now;
    this.state = this.load();
  }

  private load(): BudgetState {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<BudgetState>;
      if (typeof parsed.month === "string" && typeof parsed.spentUsd === "number") {
        return {
          month: parsed.month,
          spentUsd: parsed.spentUsd,
          notes: Number(parsed.notes) || 0,
          failures: Number(parsed.failures) || 0,
        };
      }
    } catch {
      // First run or unreadable file: start the month at zero.
    }
    return { month: utcMonth(this.now()), spentUsd: 0, notes: 0, failures: 0 };
  }

  private rollMonth(): void {
    const month = utcMonth(this.now());
    if (this.state.month !== month) this.state = { month, spentUsd: 0, notes: 0, failures: 0 };
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state));
      renameSync(tmp, this.file);
    } catch (err) {
      console.warn(`[phylax-shared-stt] could not save the meter: ${(err as Error).message}`);
    }
  }

  snapshot(): BudgetState & { capUsd: number; enabled: boolean; model: string } {
    this.rollMonth();
    return { ...this.state, capUsd: this.capUsd, enabled: this.key !== null, model: this.model };
  }

  /** The shared route for one note, or null when off or the month's cap is reached. */
  route(): PhylaxSharedTranscriptionRoute | null {
    if (!this.key) return null;
    this.rollMonth();
    if (this.state.spentUsd >= this.capUsd) return null;
    return {
      key: this.key,
      model: this.model,
      record: (entry) => this.record(entry),
    };
  }

  record(entry: { estimatedCostUsd: number; status: "succeeded" | "failed" }): void {
    this.rollMonth();
    const cost = Number.isFinite(entry.estimatedCostUsd) && entry.estimatedCostUsd > 0 ? entry.estimatedCostUsd : 0;
    this.state.spentUsd += cost;
    if (entry.status === "succeeded") this.state.notes += 1;
    else this.state.failures += 1;
    this.save();
    console.log(JSON.stringify({
      event: "shared_stt.usage",
      month: this.state.month,
      status: entry.status,
      cost_usd: Number(cost.toFixed(6)),
      spent_usd: Number(this.state.spentUsd.toFixed(6)),
      cap_usd: this.capUsd,
      notes: this.state.notes,
      failures: this.state.failures,
      stopped: this.state.spentUsd >= this.capUsd,
    }));
  }
}
