import { describe, expect, it } from "vitest";
import { parseInbound } from "./inbound";

const parse = (value: unknown) => parseInbound(JSON.stringify(value));

describe("parseInbound", () => {
  it("accepts well-formed responses and events", () => {
    expect(parse({ type: "res", seq: 1, id: "r1", ok: { a: 1 } })).toEqual({
      type: "res",
      seq: 1,
      id: "r1",
      ok: { a: 1 },
    });
    expect(
      parse({
        type: "res",
        seq: 2,
        id: "r2",
        error: { code: "x", message: "y", data: 1 },
      }),
    ).not.toBeNull();
    expect(
      parse({ type: "evt", seq: 3, event: "e", payload: null }),
    ).not.toBeNull();
    expect(
      parse({ type: "evt", seq: 4, event: "e", agent_id: null, payload: {} }),
    ).not.toBeNull();
    expect(
      parse({ type: "evt", seq: 5, event: "e", agent_id: "a1", payload: {} }),
    ).not.toBeNull();
  });

  it.each([
    ["invalid json", "{"],
    ["null", "null"],
    ["an array", "[]"],
    ["a string", '"res"'],
  ])("drops %s", (_, text) => {
    expect(parseInbound(text)).toBeNull();
  });

  it.each([
    ["missing seq", { type: "res", id: "r1" }],
    ["string seq", { type: "res", seq: "1", id: "r1" }],
    ["negative seq", { type: "evt", seq: -1, event: "e" }],
    ["fractional seq", { type: "evt", seq: 1.5, event: "e" }],
    ["unknown type", { type: "nope", seq: 1 }],
    [
      "request from the gateway",
      { type: "req", seq: 1, id: "r1", method: "m" },
    ],
    ["response without id", { type: "res", seq: 1 }],
    ["response with numeric id", { type: "res", seq: 1, id: 1 }],
    ["string error", { type: "res", seq: 1, id: "r1", error: "boom" }],
    [
      "error without message",
      { type: "res", seq: 1, id: "r1", error: { code: "x" } },
    ],
    ["event without name", { type: "evt", seq: 1, payload: {} }],
    ["numeric agent id", { type: "evt", seq: 1, event: "e", agent_id: 7 }],
  ])("drops %s", (_, value) => {
    expect(parse(value)).toBeNull();
  });
});
