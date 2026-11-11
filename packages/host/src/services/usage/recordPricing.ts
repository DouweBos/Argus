/**
 * What one usage record cost: hand-set prices and mappings first, then the
 * price list, at the speed tier the request ran at.
 */

import type { UsageRecord } from "./records";
import type { UsagePriceOverride } from "@argus/remote-protocol";
import { overrideRate } from "./priceOverrides";
import {
  costParts,
  normalizeModelKey,
  partsTotal,
  rateFor,
  type CostParts,
  type ModelRate,
  type RateTable,
} from "./pricing";
import { ratesAt } from "./speedPricing";

export interface PriceBook {
  table: RateTable;
  overrides: Map<string, UsagePriceOverride>;
}

export function priceBook(
  table: RateTable,
  overrides: UsagePriceOverride[] = [],
): PriceBook {
  return {
    table,
    overrides: new Map(overrides.map((o) => [normalizeModelKey(o.model), o])),
  };
}

function overrideFor(
  book: PriceBook,
  model: string,
): UsagePriceOverride | undefined {
  const key = normalizeModelKey(model);

  return (
    book.overrides.get(key) ?? book.overrides.get(key.replace(/-\d{8}$/, ""))
  );
}

/** The model a record counts as: its own id, or the one a mapping sends it to. */
export function countedModel(
  book: PriceBook,
  model: string,
): { model: string; mapped: boolean } {
  const mapTo = overrideFor(book, model)?.map_to;

  return mapTo ? { model: mapTo, mapped: true } : { model, mapped: false };
}

export interface ModelPrice {
  rate: ModelRate | null;
  source: "custom" | "list" | null;
}

export function modelPrice(book: PriceBook, model: string): ModelPrice {
  const custom = overrideFor(book, model);
  const customRate = custom ? overrideRate(custom) : null;
  if (customRate) {
    return { rate: customRate, source: "custom" };
  }
  const listed = rateFor(book.table, model);

  return listed
    ? { rate: listed, source: "list" }
    : { rate: null, source: null };
}

export interface PricedRecord {
  parts: CostParts;
  /** Reported spend that can't be split by kind. */
  other: number;
  /** Cost above standard rates; already inside `parts`. */
  premium: number;
  /** What cache reads saved against the input rate. */
  savings: number;
  priced: boolean;
}

const ZERO: CostParts = { input: 0, cache_read: 0, cache_write: 0, output: 0 };

const scaled = (p: CostParts, by: number): CostParts => ({
  input: p.input * by,
  cache_read: p.cache_read * by,
  cache_write: p.cache_write * by,
  output: p.output * by,
});

/**
 * A runner's reported cost wins over the list price, which then only says how
 * it splits by kind; a hand-set price wins over both.
 */
export function priceRecord(
  r: UsageRecord,
  model: string,
  price: ModelPrice,
): PricedRecord {
  const { rate } = price;
  if (!rate) {
    return r.costUsd === null
      ? { parts: ZERO, other: 0, premium: 0, savings: 0, priced: false }
      : { parts: ZERO, other: r.costUsd, premium: 0, savings: 0, priced: true };
  }
  const tier = ratesAt(rate, r.speed, model);
  const parts = costParts(tier, r);
  const estimate = partsTotal(parts);
  const premium =
    tier === rate ? 0 : Math.max(0, estimate - partsTotal(costParts(rate, r)));
  const savings = r.cacheRead * Math.max(0, tier.input - tier.cacheRead);
  if (r.costUsd === null || price.source === "custom") {
    return { parts, other: 0, premium, savings, priced: true };
  }
  if (estimate <= 0) {
    return { parts: ZERO, other: r.costUsd, premium: 0, savings, priced: true };
  }
  const scale = r.costUsd / estimate;

  return {
    parts: scaled(parts, scale),
    other: 0,
    premium: premium * scale,
    savings,
    priced: true,
  };
}
