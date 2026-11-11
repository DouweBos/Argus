/**
 * Model prices set by hand, host-wide in `~/.argus/usage-prices.json`, so every
 * client estimates the same cost. A price replaces the list price for all
 * history; `map_to` counts a model as another one.
 */

import type { UsagePriceOverride } from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { normalizeModelKey, type ModelRate } from "./pricing";

const VERSION = 1;

interface PriceOverridesFile {
  version: number;
  overrides: UsagePriceOverride[];
}

function filePath(): string {
  return path.join(argusHomeDir(), "usage-prices.json");
}

export function loadPriceOverrides(): UsagePriceOverride[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath(), "utf8");
  } catch {
    return [];
  }
  try {
    const file = JSON.parse(raw) as PriceOverridesFile;

    return file.version === VERSION && Array.isArray(file.overrides)
      ? normalizePriceOverrides(file.overrides)
      : [];
  } catch (e) {
    warn("[usage] ignoring unreadable usage-prices.json:", e);

    return [];
  }
}

export function savePriceOverrides(overrides: UsagePriceOverride[]): void {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const file: PriceOverridesFile = { version: VERSION, overrides };
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

const rateOrNull = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/**
 * Normalized ids, mapped rows without prices, sorted. Throws a string for a
 * model listed twice, a price missing its input or output rate, or a mapping
 * onto a model that is itself mapped.
 */
export function normalizePriceOverrides(
  overrides: UsagePriceOverride[],
): UsagePriceOverride[] {
  const byModel = new Map<string, UsagePriceOverride>();
  for (const o of overrides) {
    const model = normalizeModelKey(o.model);
    if (!model) {
      throw "A model price needs a model id.";
    }
    if (byModel.has(model)) {
      throw `${model} has more than one price.`;
    }
    const mapTo = o.map_to ? normalizeModelKey(o.map_to) : "";
    if (mapTo) {
      if (mapTo === model) {
        throw `${model} can't be mapped to itself.`;
      }
      byModel.set(model, {
        model,
        input_per_mtok: null,
        output_per_mtok: null,
        cache_read_per_mtok: null,
        cache_write_per_mtok: null,
        map_to: mapTo,
      });
      continue;
    }
    const input = rateOrNull(o.input_per_mtok);
    const output = rateOrNull(o.output_per_mtok);
    if (input === null || output === null) {
      throw `${model} needs an input and an output price.`;
    }
    byModel.set(model, {
      model,
      input_per_mtok: input,
      output_per_mtok: output,
      cache_read_per_mtok: rateOrNull(o.cache_read_per_mtok),
      cache_write_per_mtok: rateOrNull(o.cache_write_per_mtok),
      map_to: null,
    });
  }
  for (const o of byModel.values()) {
    if (o.map_to && byModel.get(o.map_to)?.map_to) {
      throw `${o.model} maps to ${o.map_to}, which is mapped to another model itself.`;
    }
  }

  return [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model));
}

/** Per-token rates from a hand-set price; unset cache rates use the input rate. */
export function overrideRate(o: UsagePriceOverride): ModelRate | null {
  if (o.input_per_mtok === null || o.output_per_mtok === null) {
    return null;
  }
  const input = o.input_per_mtok / 1e6;
  const cacheWrite = (o.cache_write_per_mtok ?? o.input_per_mtok) / 1e6;

  return {
    input,
    output: o.output_per_mtok / 1e6,
    cacheRead: (o.cache_read_per_mtok ?? o.input_per_mtok) / 1e6,
    cacheWrite,
    cacheWrite1h: cacheWrite,
  };
}
