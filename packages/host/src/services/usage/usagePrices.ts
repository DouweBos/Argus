/** The price editor's commands: hand-set prices next to the list prices they replace. */

import type { UsageRecord } from "./records";
import type {
  UsageListPrice,
  UsagePriceOverride,
  UsagePrices,
} from "@argus/remote-protocol";
import { capture } from "../telemetry/telemetry";
import {
  loadPriceOverrides,
  normalizePriceOverrides,
  savePriceOverrides,
} from "./priceOverrides";
import {
  loadRateTable,
  normalizeModelKey,
  rateFor,
  type RateTable,
} from "./pricing";
import { loadAllUsageRecords } from "./sources";

const LIST_WINDOW_MS = 90 * 24 * 60 * 60_000;

const perMillion = (perToken: number) => Math.round(perToken * 1e6 * 1e6) / 1e6;

/** List prices of the models in `records`, per million tokens, by model id. */
export function listPrices(
  records: Pick<UsageRecord, "model">[],
  table: RateTable,
): UsageListPrice[] {
  const out = new Map<string, UsageListPrice>();
  for (const r of records) {
    const model = normalizeModelKey(r.model);
    if (out.has(model)) {
      continue;
    }
    const rate = rateFor(table, model);
    if (rate) {
      out.set(model, {
        model,
        input_per_mtok: perMillion(rate.input),
        output_per_mtok: perMillion(rate.output),
        cache_read_per_mtok: perMillion(rate.cacheRead),
        cache_write_per_mtok: perMillion(rate.cacheWrite),
      });
    }
  }

  return [...out.values()].sort((a, b) => a.model.localeCompare(b.model));
}

export async function getUsagePrices(): Promise<UsagePrices> {
  const since = Date.now() - LIST_WINDOW_MS;
  const [records, prices] = await Promise.all([
    loadAllUsageRecords(since),
    loadRateTable(),
  ]);

  return {
    overrides: loadPriceOverrides(),
    list: listPrices(
      records.filter((r) => r.at >= since),
      prices.table,
    ),
  };
}

export async function setUsagePrices(
  overrides: UsagePriceOverride[],
): Promise<UsagePrices> {
  const normalized = normalizePriceOverrides(overrides);
  savePriceOverrides(normalized);
  capture("usage_prices_saved", {
    override_count: normalized.length,
    mapped_count: normalized.filter((o) => o.map_to !== null).length,
  });

  return getUsagePrices();
}
