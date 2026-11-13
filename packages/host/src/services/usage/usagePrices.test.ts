import type { RateTable } from "./pricing";
import { describe, expect, it } from "vitest";
import { listPrices } from "./usagePrices";

describe("listPrices", () => {
  const table: RateTable = new Map([
    [
      "claude-x",
      {
        input: 3e-6,
        output: 1.5e-5,
        cacheRead: 3e-7,
        cacheWrite: 3.75e-6,
        cacheWrite1h: 6e-6,
      },
    ],
  ]);

  it("lists each priced model once, per million tokens", () => {
    expect(
      listPrices(
        [
          { model: "claude-x" },
          { model: "Claude-X-20260101" },
          { model: "claude-x[1m]" },
          { model: "unknown" },
        ],
        table,
      ),
    ).toEqual([
      {
        model: "claude-x",
        input_per_mtok: 3,
        output_per_mtok: 15,
        cache_read_per_mtok: 0.3,
        cache_write_per_mtok: 3.75,
      },
      {
        model: "claude-x-20260101",
        input_per_mtok: 3,
        output_per_mtok: 15,
        cache_read_per_mtok: 0.3,
        cache_write_per_mtok: 3.75,
      },
    ]);
  });
});
