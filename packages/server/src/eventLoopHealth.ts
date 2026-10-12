import { monitorEventLoopDelay, performance, type EventLoopUtilization, type IntervalHistogram } from "node:perf_hooks";

/** Event-loop health over the last completed window; reported in /api/health, never gates it. */
export interface EventLoopHealth {
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
  /** 0..1 fraction of the window the loop was busy (performance.eventLoopUtilization). */
  utilization: number;
  windowMs: number;
  /** True when this is a completed window; false while the first window is still filling. */
  complete: boolean;
}

export interface EventLoopMonitorOptions {
  windowMs?: number;
  resolutionMs?: number;
  p99WarnMs?: number;
  utilizationWarn?: number;
  /** Minimum gap between warnings. */
  warnIntervalMs?: number;
  warn?: (entry: Record<string, unknown>) => void;
  now?: () => number;
}

const NS = 1e6;
const round = (n: number, d = 2) => Number(n.toFixed(d));

function envNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function eventLoopOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): EventLoopMonitorOptions {
  return {
    windowMs: envNumber(env, "EVENT_LOOP_WINDOW_MS", 60_000),
    p99WarnMs: envNumber(env, "EVENT_LOOP_P99_WARN_MS", 200),
    utilizationWarn: envNumber(env, "EVENT_LOOP_UTILIZATION_WARN", 0.8),
  };
}

export class EventLoopMonitor {
  private readonly histogram: IntervalHistogram;
  private readonly windowMs: number;
  private readonly p99WarnMs: number;
  private readonly utilizationWarn: number;
  private readonly warnIntervalMs: number;
  private readonly warn: (entry: Record<string, unknown>) => void;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private elu0: EventLoopUtilization = performance.eventLoopUtilization();
  private windowStart: number;
  private last: EventLoopHealth | null = null;
  private lastWarnAt = Number.NEGATIVE_INFINITY;

  constructor(options: EventLoopMonitorOptions = {}) {
    this.windowMs = options.windowMs ?? 60_000;
    this.p99WarnMs = options.p99WarnMs ?? 200;
    this.utilizationWarn = options.utilizationWarn ?? 0.8;
    this.warnIntervalMs = options.warnIntervalMs ?? 60_000;
    this.warn = options.warn ?? ((entry) => console.warn(JSON.stringify(entry)));
    this.now = options.now ?? Date.now;
    this.histogram = monitorEventLoopDelay({ resolution: options.resolutionMs ?? 20 });
    this.windowStart = this.now();
  }

  start(): this {
    if (this.timer) return this;
    this.histogram.enable();
    this.elu0 = performance.eventLoopUtilization();
    this.windowStart = this.now();
    this.timer = setInterval(() => this.rollWindow(), this.windowMs);
    this.timer.unref();
    return this;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.histogram.disable();
  }

  /** Close the current window: publish it, maybe warn, reset. Exposed for tests. */
  rollWindow(): EventLoopHealth {
    const snapshot = this.read(true);
    this.last = snapshot;
    this.histogram.reset();
    this.elu0 = performance.eventLoopUtilization();
    this.windowStart = this.now();
    this.maybeWarn(snapshot);
    return snapshot;
  }

  /** Last completed window, or the partial current window before the first roll. */
  snapshot(): EventLoopHealth {
    return this.last ?? this.read(false);
  }

  private read(complete: boolean): EventLoopHealth {
    const h = this.histogram;
    // Histogram is empty (sentinel min/max values) before the first sample lands.
    const empty = h.count === 0;
    return {
      p50Ms: empty ? 0 : round(h.percentile(50) / NS),
      p99Ms: empty ? 0 : round(h.percentile(99) / NS),
      maxMs: empty ? 0 : round(h.max / NS),
      utilization: round(performance.eventLoopUtilization(this.elu0).utilization, 3),
      windowMs: Math.max(0, this.now() - this.windowStart),
      complete,
    };
  }

  private maybeWarn(s: EventLoopHealth): void {
    if (s.p99Ms <= this.p99WarnMs && s.utilization <= this.utilizationWarn) return;
    const t = this.now();
    if (t - this.lastWarnAt < this.warnIntervalMs) return;
    this.lastWarnAt = t;
    this.warn({
      level: "warn",
      event: "event_loop.lag",
      p50_ms: s.p50Ms,
      p99_ms: s.p99Ms,
      max_ms: s.maxMs,
      utilization: s.utilization,
      window_ms: s.windowMs,
      p99_threshold_ms: this.p99WarnMs,
      utilization_threshold: this.utilizationWarn,
    });
  }
}

let shared: EventLoopMonitor | null = null;

/** Process-wide monitor, started lazily on first use (unref'd, so it never keeps the process alive). */
export function sharedEventLoopMonitor(): EventLoopMonitor {
  if (!shared) shared = new EventLoopMonitor(eventLoopOptionsFromEnv()).start();
  return shared;
}

export function eventLoopHealth(): EventLoopHealth {
  return sharedEventLoopMonitor().snapshot();
}
