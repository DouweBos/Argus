import type { UsagePrices } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  addPriceDraftRow,
  placeholderFor,
  priceDraftDirty,
  priceDraftRows,
  priceOverridesFromDraft,
  resetPriceDraftRow,
} from "./usagePriceDraft";

const prices: UsagePrices = {
  overrides: [
    {
      model: "local-llama",
      input_per_mtok: 0,
      output_per_mtok: 0,
      cache_read_per_mtok: null,
      cache_write_per_mtok: null,
      map_to: null,
    },
    {
      model: "opus-preview",
      input_per_mtok: null,
      output_per_mtok: null,
      cache_read_per_mtok: null,
      cache_write_per_mtok: null,
      map_to: "claude-opus-4-5",
    },
  ],
  list: [
    {
      model: "claude-opus-4-5",
      input_per_mtok: 5,
      output_per_mtok: 25,
      cache_read_per_mtok: 0.5,
      cache_write_per_mtok: 6.25,
    },
  ],
};

describe("price draft", () => {
  it("lists prices set by hand, then list-priced models", () => {
    const rows = priceDraftRows(prices);
    expect(rows.map((r) => [r.model, r.saved])).toEqual([
      ["local-llama", true],
      ["opus-preview", true],
      ["claude-opus-4-5", false],
    ]);
    expect(rows[1]?.mapTo).toBe("claude-opus-4-5");
    expect(placeholderFor(rows[2]!, "output")).toBe("25");
    expect(placeholderFor(rows[0]!, "cacheRead")).toBe("= input");
  });

  it("round-trips unchanged rows to the same overrides", () => {
    const rows = priceDraftRows(prices);
    expect(priceOverridesFromDraft(rows)).toEqual(prices.overrides);
    expect(priceDraftDirty(rows, prices)).toBe(false);
  });

  it("fills empty fields of an edited list row from the list price", () => {
    const rows = priceDraftRows(prices).map((r) =>
      r.model === "claude-opus-4-5" ? { ...r, output: "20" } : r,
    );
    expect(priceOverridesFromDraft(rows)[2]).toEqual({
      model: "claude-opus-4-5",
      input_per_mtok: 5,
      output_per_mtok: 20,
      cache_read_per_mtok: 0.5,
      cache_write_per_mtok: 6.25,
      map_to: null,
    });
    expect(priceDraftDirty(rows, prices)).toBe(true);
  });

  it("resets a saved price until saved, and drops a new one", () => {
    const rows = priceDraftRows(prices);
    const reset = resetPriceDraftRow(rows[0]!);
    expect(reset?.reset).toBe(true);
    expect(
      priceOverridesFromDraft([reset!, ...rows.slice(1)]).map((o) => o.model),
    ).toEqual(["opus-preview"]);
    const added = addPriceDraftRow(rows, " new-model ");
    expect(added[0]?.model).toBe("new-model");
    expect(resetPriceDraftRow(added[0]!)).toBeNull();
    expect(addPriceDraftRow(added, "new-model")).toBe(added);
  });

  it("explains a price it can't save", () => {
    const [row] = addPriceDraftRow([], "mystery");
    expect(() => priceOverridesFromDraft([{ ...row!, output: "3" }])).toThrow(
      "mystery needs an input and an output price",
    );
    expect(() =>
      priceOverridesFromDraft([{ ...row!, input: "abc", output: "3" }]),
    ).toThrow("isn't a number");
  });
});
