/**
 * The model price editor's draft: one row per model with a price set by hand
 * or a recently used list price, edited as text and turned back into
 * `UsagePriceOverride`s on save. Mirrored by the native apps' price editor.
 */

import type {
  UsageListPrice,
  UsagePriceOverride,
  UsagePrices,
} from "@argus/remote-protocol";

export type PriceField = "cacheRead" | "cacheWrite" | "input" | "output";

export const PRICE_FIELDS: PriceField[] = [
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
];

export interface PriceDraftRow {
  model: string;
  /** Text as typed; empty falls back to the placeholder. */
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
  mapTo: string;
  /** The list price the placeholders show; null for a model the list lacks. */
  list: UsageListPrice | null;
  /** Saved as a price set by hand. */
  saved: boolean;
  /** Back to automatic on save; undoable until then. */
  reset: boolean;
}

const text = (v: number | null): string => (v === null ? "" : String(v));

function fromOverride(
  o: UsagePriceOverride,
  list: UsageListPrice | null,
): PriceDraftRow {
  return {
    model: o.model,
    input: text(o.input_per_mtok),
    output: text(o.output_per_mtok),
    cacheRead: text(o.cache_read_per_mtok),
    cacheWrite: text(o.cache_write_per_mtok),
    mapTo: o.map_to ?? "",
    list,
    saved: true,
    reset: false,
  };
}

function blank(model: string, list: UsageListPrice | null): PriceDraftRow {
  return {
    model,
    input: "",
    output: "",
    cacheRead: "",
    cacheWrite: "",
    mapTo: "",
    list,
    saved: false,
    reset: false,
  };
}

/** Prices set by hand first, then the list-priced models seen lately. */
export function priceDraftRows(prices: UsagePrices): PriceDraftRow[] {
  const listFor = (model: string) =>
    prices.list.find((l) => l.model === model) ?? null;
  const overridden = new Set(prices.overrides.map((o) => o.model));

  return [
    ...prices.overrides.map((o) => fromOverride(o, listFor(o.model))),
    ...prices.list
      .filter((l) => !overridden.has(l.model))
      .map((l) => blank(l.model, l)),
  ];
}

/** Adds a model at the top, or leaves the rows be when it's already there. */
export function addPriceDraftRow(
  rows: PriceDraftRow[],
  model: string,
  list: UsageListPrice[] = [],
): PriceDraftRow[] {
  const id = model.trim();
  if (!id || rows.some((r) => r.model === id)) {
    return rows;
  }

  return [blank(id, list.find((l) => l.model === id) ?? null), ...rows];
}

/** The list price a field shows as its placeholder. */
export function placeholderFor(row: PriceDraftRow, field: PriceField): string {
  const cache = field === "cacheRead" || field === "cacheWrite";
  if (!row.list || (cache && row.saved)) {
    return cache ? "= input" : "";
  }
  const values: Record<PriceField, number> = {
    input: row.list.input_per_mtok,
    output: row.list.output_per_mtok,
    cacheRead: row.list.cache_read_per_mtok,
    cacheWrite: row.list.cache_write_per_mtok,
  };

  return String(values[field]);
}

/** Something typed: it saves as a price set by hand. */
export function isEdited(row: PriceDraftRow): boolean {
  return (
    row.mapTo.trim() !== "" || PRICE_FIELDS.some((f) => row[f].trim() !== "")
  );
}

/** What "Reset to automatic" does: drop a saved price, or clear what's typed. */
export function resetPriceDraftRow(row: PriceDraftRow): PriceDraftRow | null {
  if (row.saved) {
    return { ...row, reset: true };
  }
  if (!row.list) {
    // A model added here has nothing automatic to go back to.
    return null;
  }

  return blank(row.model, row.list);
}

const FIELD_NAMES: Record<PriceField, string> = {
  input: "input",
  output: "output",
  cacheRead: "cache read",
  cacheWrite: "cache write",
};

function rate(
  row: PriceDraftRow,
  field: PriceField,
  fallback: number | null,
): number | null {
  const raw = row[field].trim();
  if (raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw `${row.model}: the ${FIELD_NAMES[field]} price isn't a number of dollars.`;
  }

  return value;
}

/**
 * The overrides to save. An empty field takes the list price; with none, an
 * empty cache rate stays null (the input rate). Throws a string to show inline.
 */
export function priceOverridesFromDraft(
  rows: PriceDraftRow[],
): UsagePriceOverride[] {
  return rows
    .filter((r) => !r.reset && isEdited(r))
    .map((r) => {
      const mapTo = r.mapTo.trim();
      if (mapTo) {
        return {
          model: r.model,
          input_per_mtok: null,
          output_per_mtok: null,
          cache_read_per_mtok: null,
          cache_write_per_mtok: null,
          map_to: mapTo,
        };
      }
      const input = rate(r, "input", r.list?.input_per_mtok ?? null);
      const output = rate(r, "output", r.list?.output_per_mtok ?? null);
      if (input === null || output === null) {
        throw `${r.model} needs an input and an output price, or a model to map to.`;
      }
      // A saved price keeps its empty cache rates at the input rate.
      const listCache = r.saved ? null : r.list;

      return {
        model: r.model,
        input_per_mtok: input,
        output_per_mtok: output,
        cache_read_per_mtok: rate(
          r,
          "cacheRead",
          listCache?.cache_read_per_mtok ?? null,
        ),
        cache_write_per_mtok: rate(
          r,
          "cacheWrite",
          listCache?.cache_write_per_mtok ?? null,
        ),
        map_to: null,
      };
    });
}

/** Anything to save compared with what the host has. */
export function priceDraftDirty(
  rows: PriceDraftRow[],
  prices: UsagePrices,
): boolean {
  const sorted = (list: UsagePriceOverride[]) =>
    JSON.stringify([...list].sort((a, b) => a.model.localeCompare(b.model)));
  try {
    return sorted(priceOverridesFromDraft(rows)) !== sorted(prices.overrides);
  } catch {
    return true;
  }
}
