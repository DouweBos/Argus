/**
 * Claude Code's `total_cost_usd` runs across turns and resumes; everything
 * downstream adds it up per turn, so each result gets rewritten to its turn's.
 */

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function costSinceLastResult(event: Json): number | null {
  const models = event.model_usage_since_last_result;
  if (!isRecord(models)) {
    return null;
  }
  let sum = 0;
  for (const usage of Object.values(models)) {
    if (isRecord(usage) && typeof usage.costUSD === "number") {
      sum += usage.costUSD;
    }
  }

  return sum;
}

export class TurnCost {
  private total: number | null;

  /** A resume's total already holds its earlier turns, by an unknown amount. */
  constructor(resumed: boolean) {
    this.total = resumed ? null : 0;
  }

  rewrite(line: string): string {
    const result = line.includes('"result"');
    if (!result && !line.includes('"conversation_reset"')) {
      return line;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return line;
    }
    if (!isRecord(event)) {
      return line;
    }
    if (event.type === "conversation_reset") {
      this.total = 0;

      return line;
    }
    if (event.type !== "result" || typeof event.total_cost_usd !== "number") {
      return line;
    }
    const cost = costSinceLastResult(event) ?? this.delta(event.total_cost_usd);
    // A crash's zeroed total says nothing about the running one.
    if (event.total_cost_usd > 0) {
      this.total = event.total_cost_usd;
    }

    return JSON.stringify({ ...event, total_cost_usd: cost ?? undefined });
  }

  private delta(total: number): number | null {
    if (total <= 0) {
      return 0;
    }
    if (this.total === null) {
      return null;
    }

    return total < this.total ? total : total - this.total;
  }
}
