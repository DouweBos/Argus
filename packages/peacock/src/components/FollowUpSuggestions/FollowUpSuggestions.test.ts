import { describe, expect, it } from "vitest";
import { followUpCompletion } from "./FollowUpSuggestions";

const ITEMS = ["Yes, add the tests", "Commit it"];

describe("followUpCompletion", () => {
  it("completes a typed prefix, case-insensitively", () => {
    expect(followUpCompletion("yes, add", ITEMS)).toBe(" the tests");
    expect(followUpCompletion("Comm", ITEMS)).toBe("it it");
  });

  it("offers nothing for an empty input or a non-prefix", () => {
    expect(followUpCompletion("", ITEMS)).toBeNull();
    expect(followUpCompletion("   ", ITEMS)).toBeNull();
    expect(followUpCompletion("Please", ITEMS)).toBeNull();
  });

  it("offers nothing once the whole suggestion is typed", () => {
    expect(followUpCompletion("Commit it", ITEMS)).toBeNull();
  });

  it("offers nothing across lines", () => {
    expect(followUpCompletion("Yes\n", ITEMS)).toBeNull();
  });
});
