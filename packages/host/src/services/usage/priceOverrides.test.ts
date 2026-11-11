import type { UsagePriceOverride } from "@argus/remote-protocol";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPriceOverrides,
  normalizePriceOverrides,
  overrideRate,
  savePriceOverrides,
} from "./priceOverrides";

const price = (
  model: string,
  over: Partial<UsagePriceOverride> = {},
): UsagePriceOverride => ({
  model,
  input_per_mtok: 3,
  output_per_mtok: 15,
  cache_read_per_mtok: null,
  cache_write_per_mtok: null,
  map_to: null,
  ...over,
});

describe("normalizePriceOverrides", () => {
  it("normalizes ids and clears the prices of a mapped model", () => {
    expect(
      normalizePriceOverrides([
        price("Anthropic/Claude-X[1m]"),
        price("preview-y", { map_to: "openai/Claude-X" }),
      ]),
    ).toEqual([
      price("claude-x"),
      {
        ...price("preview-y", { map_to: "claude-x" }),
        input_per_mtok: null,
        output_per_mtok: null,
      },
    ]);
  });

  it("rejects duplicates, missing rates, self maps and chains", () => {
    expect(() => normalizePriceOverrides([price("a"), price("A")])).toThrow(
      "a has more than one price.",
    );
    expect(() =>
      normalizePriceOverrides([price("a", { output_per_mtok: null })]),
    ).toThrow("a needs an input and an output price.");
    expect(() =>
      normalizePriceOverrides([price("a", { map_to: "a" })]),
    ).toThrow("a can't be mapped to itself.");
    expect(() =>
      normalizePriceOverrides([
        price("a", { map_to: "b" }),
        price("b", { map_to: "c" }),
      ]),
    ).toThrow("a maps to b, which is mapped to another model itself.");
    expect(() =>
      normalizePriceOverrides([
        price("a", { map_to: "b" }),
        price("b", { map_to: "a" }),
      ]),
    ).toThrow();
  });
});

describe("overrideRate", () => {
  it("converts per-million prices and falls back to the input rate", () => {
    expect(overrideRate(price("a", { cache_read_per_mtok: 0 }))).toEqual({
      input: 3e-6,
      output: 15e-6,
      cacheRead: 0,
      cacheWrite: 3e-6,
      cacheWrite1h: 3e-6,
    });
  });
});

describe("price overrides file", () => {
  let home: string;
  const previous = process.env.ARGUS_HOME;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-prices-"));
    process.env.ARGUS_HOME = home;
  });
  afterEach(() => {
    if (previous === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previous;
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("round-trips and ignores a corrupt file", () => {
    expect(loadPriceOverrides()).toEqual([]);
    savePriceOverrides([price("claude-x")]);
    expect(loadPriceOverrides()).toEqual([price("claude-x")]);
    fs.writeFileSync(path.join(home, "usage-prices.json"), "{nope");
    expect(loadPriceOverrides()).toEqual([]);
  });
});
