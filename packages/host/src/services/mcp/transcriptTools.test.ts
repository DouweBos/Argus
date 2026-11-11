import { describe, expect, it } from "vitest";
import { sliceWindow } from "./transcriptTools";

describe("sliceWindow", () => {
  it("defaults to the last 50 messages", () => {
    expect(sliceWindow(120, {})).toEqual([70, 120]);
    expect(sliceWindow(10, {})).toEqual([0, 10]);
    expect(sliceWindow(120, { tail_messages: 0 })).toEqual([0, 120]);
  });

  it("pages with offset and limit, negative offsets from the end", () => {
    expect(sliceWindow(100, { offset: 20, limit: 10 })).toEqual([20, 30]);
    expect(sliceWindow(100, { offset: -5 })).toEqual([95, 100]);
    expect(sliceWindow(100, { offset: 200, limit: 5 })).toEqual([100, 100]);
  });

  it("takes the head when asked", () => {
    expect(sliceWindow(100, { head_messages: 3 })).toEqual([0, 3]);
  });
});
