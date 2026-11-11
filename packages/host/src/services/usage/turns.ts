/**
 * What a finished turn cost, for every runner: a hand-set price, else the
 * runner's own figure, else its tokens at list prices. Turns from runners with no usage
 * history of their own are written to the ledger for the Usage screen.
 */

import { appendLedgerEntry } from "./ledger";
import { loadPriceOverrides } from "./priceOverrides";
import { cachedRateTable, partsTotal } from "./pricing";
import {
  countedModel,
  modelPrice,
  priceBook,
  priceRecord,
} from "./recordPricing";
import { tokenCount, type UsageRecord } from "./records";
import { OWN_HISTORY_RUNNERS } from "./sources";

export interface TurnResult {
  total_cost_usd?: number;
  usage?: unknown;
  modelUsage?: unknown;
}

export interface TurnContext {
  agentId: string;
  runnerId: string;
  /** The built-in a custom runner derives from; its CLI decides where usage lives. */
  baseRunnerId?: string | null;
  model?: string | null;
  at?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function modelOf(result: TurnResult, fallback: string | null | undefined) {
  const reported = isRecord(result.modelUsage)
    ? Object.keys(result.modelUsage)[0]
    : undefined;

  return reported || fallback || "default";
}

/** The turn's cost in USD; 0 when it reported none and its model has no list price. */
export function recordTurnUsage(ctx: TurnContext, result: TurnResult): number {
  const usage = isRecord(result.usage) ? result.usage : {};
  const tokens = {
    input: tokenCount(usage.input_tokens),
    cacheRead: tokenCount(usage.cache_read_input_tokens),
    cacheWrite5m: tokenCount(usage.cache_creation_input_tokens),
    cacheWrite1h: 0,
    output: tokenCount(usage.output_tokens),
  };
  const model = modelOf(result, ctx.model);
  const reported =
    typeof result.total_cost_usd === "number" &&
    Number.isFinite(result.total_cost_usd)
      ? Math.max(0, result.total_cost_usd)
      : null;
  const tokenTotal =
    tokens.input + tokens.cacheRead + tokens.cacheWrite5m + tokens.output;
  let cost = reported ?? 0;
  if (tokenTotal > 0) {
    // Same precedence as the Usage screen: a hand-set price beats the runner's report.
    const book = priceBook(
      cachedRateTable() ?? new Map(),
      loadPriceOverrides(),
    );
    const counted = countedModel(book, model).model;
    const priced = priceRecord(
      { ...tokens, costUsd: reported } as UsageRecord,
      counted,
      modelPrice(book, counted),
    );
    cost = partsTotal(priced.parts) + priced.other;
  }

  const base = ctx.baseRunnerId ?? ctx.runnerId;
  if (
    !OWN_HISTORY_RUNNERS.has(base) &&
    (tokenTotal > 0 || (reported ?? 0) > 0)
  ) {
    appendLedgerEntry({
      at: ctx.at ?? Date.now(),
      runner: ctx.runnerId,
      model,
      agent_id: ctx.agentId,
      input: tokens.input,
      cache_read: tokens.cacheRead,
      cache_write: tokens.cacheWrite5m,
      output: tokens.output,
      cost_usd: reported,
    });
  }

  return cost;
}
