import { describe, expect, it } from "vitest";
import { usageTokens } from "./usageTokens";

describe("usageTokens", () => {
  it("sums input, output and cache tokens", () => {
    expect(
      usageTokens({
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 3,
        service_tier: "standard",
      }),
    ).toBe(118);
  });

  it("ignores a missing or malformed usage", () => {
    expect(usageTokens(undefined)).toBe(0);
    expect(usageTokens({ input_tokens: "12", output_tokens: -4 })).toBe(0);
  });
});
