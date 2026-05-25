// ── Harness-style Metrics / Telemetry ───────────────────────────────────────
// Lightweight in-process metrics for observability. Tracks counters, timers,
// and gauges. Emits periodic summaries when CODEGRUNT_TELEMETRY=1.
//
// This is intentionally simple — not a full OpenTelemetry setup.
// It provides the hooks needed for Harness-style pipeline observability.

export interface MetricsSnapshot {
  counters: Record<string, number>;
  timers: Record<string, { count: number; totalMs: number; minMs: number; maxMs: number }>;
  uptimeMs: number;
}

export class Metrics {
  private counters = new Map<string, number>();
  private timers = new Map<string, number[]>();
  private startTime = Date.now();

  // ── Counters ──────────────────────────────────────────────────────────

  increment(name: string, by = 1): void {
    const current = this.counters.get(name) ?? 0;
    this.counters.set(name, current + by);
  }

  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  // ── Timers ────────────────────────────────────────────────────────────

  /** Start a timer. Returns a stop function that records the duration. */
  startTimer(name: string): () => number {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.recordTimer(name, duration);
      return duration;
    };
  }

  private recordTimer(name: string, ms: number): void {
    if (!this.timers.has(name)) this.timers.set(name, []);
    this.timers.get(name)!.push(ms);
  }

  // ── Snapshot ──────────────────────────────────────────────────────────

  snapshot(): MetricsSnapshot {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v;

    const timers: Record<string, { count: number; totalMs: number; minMs: number; maxMs: number }> = {};
    for (const [name, values] of this.timers) {
      if (values.length === 0) continue;
      let sum = 0, min = Infinity, max = -Infinity;
      for (const v of values) {
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      timers[name] = { count: values.length, totalMs: sum, minMs: min, maxMs: max };
    }

    return {
      counters,
      timers,
      uptimeMs: Date.now() - this.startTime,
    };
  }

  /** Print summary to stderr */
  printSummary(): void {
    const s = this.snapshot();
    if (Object.keys(s.counters).length === 0 && Object.keys(s.timers).length === 0) return;

    const lines: string[] = ['\n── Metrics ──'];
    if (Object.keys(s.counters).length > 0) {
      lines.push('Counters:');
      for (const [k, v] of Object.entries(s.counters)) {
        lines.push(`  ${k}: ${v}`);
      }
    }
    if (Object.keys(s.timers).length > 0) {
      lines.push('Timers (ms):');
      for (const [k, t] of Object.entries(s.timers)) {
        const avg = (t.totalMs / t.count).toFixed(1);
        lines.push(`  ${k}: avg=${avg} min=${t.minMs.toFixed(1)} max=${t.maxMs.toFixed(1)} count=${t.count}`);
      }
    }
    process.stderr.write(lines.join('\n') + '\n');
  }

  reset(): void {
    this.counters.clear();
    this.timers.clear();
    this.startTime = Date.now();
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

let defaultMetrics: Metrics | null = null;

export function getDefaultMetrics(): Metrics {
  if (!defaultMetrics) defaultMetrics = new Metrics();
  return defaultMetrics;
}

export function resetDefaultMetrics(): void {
  defaultMetrics = null;
}
