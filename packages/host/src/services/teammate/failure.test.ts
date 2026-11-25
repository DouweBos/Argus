import { describe, expect, it } from "vitest";
import { crashFailure, interruptedFailure, resultFailure } from "./failure";

describe("thread failure reasons", () => {
  it("names a spent usage limit and keeps its reset", () => {
    expect(
      resultFailure("Claude AI usage limit reached|1700000000", 42, 1),
    ).toEqual({
      kind: "limit",
      reason: "Hit the usage limit.",
      at: 1,
      resets_at: 42,
    });
  });

  it("sends a revoked sign-in to the account", () => {
    expect(
      resultFailure("Invalid API key · Please run /login", null, 1).kind,
    ).toBe("auth");
  });

  it("keeps the first line of any other error, trimmed", () => {
    const failure = resultFailure(`  ${"x".repeat(300)}\nstack`, null, 1);
    expect(failure.kind).toBe("error");
    expect(failure.reason).toHaveLength(200);
    expect(resultFailure("", null, 1).reason).toBe(
      "The turn ended with an error.",
    );
  });

  it("words a crash and a restart", () => {
    expect(crashFailure(137, 1).reason).toContain("exit code 137");
    expect(crashFailure(null, 1).kind).toBe("crashed");
    expect(interruptedFailure(1)).toMatchObject({
      kind: "interrupted",
      reason: "Interrupted by a restart.",
    });
  });
});
