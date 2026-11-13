/** Per-model and per-speed tallies behind the usage summary. */

import type {
  UsageModelRow,
  UsageSpeed,
  UsageSpeedRow,
  UsageTokenTotals,
} from "@argus/remote-protocol";

export const emptyTokens = (): UsageTokenTotals => ({
  processed: 0,
  input: 0,
  cache_read: 0,
  cache_write: 0,
  output: 0,
});

export function addTokens(
  into: UsageTokenTotals,
  t: { input: number; cacheRead: number; cacheWrite: number; output: number },
): number {
  const total = t.input + t.cacheRead + t.cacheWrite + t.output;
  into.processed += total;
  into.input += t.input;
  into.cache_read += t.cacheRead;
  into.cache_write += t.cacheWrite;
  into.output += t.output;

  return total;
}

interface ModelTally {
  model: string;
  runner: string;
  /** Hand-set or list price; null when only the runner's own figure is known. */
  priceSource: "custom" | "list" | null;
  reported: boolean;
  tokens: UsageTokenTotals;
  cost: number;
  mappedFrom: Set<string>;
  series: { start: number; tokens: number; cost_usd: number }[];
}

export class ModelTallies {
  private readonly rows = new Map<string, ModelTally>();

  constructor(private readonly starts: number[]) {}

  add(entry: {
    runner: string;
    model: string;
    /** The record's own id when a mapping counted it as `model`. */
    mappedFrom: string | null;
    priceSource: "custom" | "list" | null;
    reported: boolean;
    tokens: {
      input: number;
      cacheRead: number;
      cacheWrite: number;
      output: number;
    };
    cost: number;
    bucket: number;
  }): void {
    const key = `${entry.runner}\u0000${entry.model}`;
    let row = this.rows.get(key);
    if (!row) {
      row = {
        model: entry.model,
        runner: entry.runner,
        priceSource: entry.priceSource,
        reported: false,
        tokens: emptyTokens(),
        cost: 0,
        mappedFrom: new Set(),
        series: this.starts.map((start) => ({ start, tokens: 0, cost_usd: 0 })),
      };
      this.rows.set(key, row);
    }
    const total = addTokens(row.tokens, entry.tokens);
    row.cost += entry.cost;
    row.reported ||= entry.reported;
    if (entry.mappedFrom !== null) {
      row.mappedFrom.add(entry.mappedFrom);
    }
    row.series[entry.bucket].tokens += total;
    row.series[entry.bucket].cost_usd += entry.cost;
  }

  list(): UsageModelRow[] {
    return [...this.rows.values()].map((t) => {
      const source =
        t.priceSource ??
        (t.reported ? ("reported" as const) : ("none" as const));

      return {
        model: t.model,
        tokens: t.tokens.processed,
        cost_usd: t.cost,
        priced: source !== "none",
        runner: t.runner,
        price_source: source,
        ...(t.mappedFrom.size > 0
          ? { mapped_from: [...t.mappedFrom].sort() }
          : {}),
        token_kinds: t.tokens,
        series: t.series,
      };
    });
  }
}

const SPEED_ORDER: UsageSpeed[] = ["standard", "fast", "ultrafast"];

export class SpeedTallies {
  private readonly rows = new Map<UsageSpeed, UsageSpeedRow>();

  add(speed: UsageSpeed, tokens: number, cost: number, premium: number): void {
    const row = this.rows.get(speed) ?? {
      speed,
      tokens: 0,
      cost_usd: 0,
      premium_usd: 0,
    };
    row.tokens += tokens;
    row.cost_usd += cost;
    row.premium_usd += premium;
    this.rows.set(speed, row);
  }

  /** Undefined when everything ran at standard speed. */
  list(): UsageSpeedRow[] | undefined {
    if ([...this.rows.keys()].every((s) => s === "standard")) {
      return undefined;
    }

    return SPEED_ORDER.flatMap((s) => {
      const row = this.rows.get(s);

      return row ? [row] : [];
    });
  }
}
