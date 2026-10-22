import { describe, expect, it } from "vitest";
import { parseFollowUps } from "./followUps";

describe("parseFollowUps", () => {
  it("reads a JSON array, even wrapped in prose or a fence", () => {
    expect(parseFollowUps('["Add the tests", "Commit it"]')).toEqual([
      "Add the tests",
      "Commit it",
    ]);
    expect(parseFollowUps('Sure:\n```json\n["Ship it"]\n```')).toEqual([
      "Ship it",
    ]);
  });

  it("keeps at most three, deduplicated and trimmed", () => {
    expect(parseFollowUps('["  a  b ", "A B", "c", "d", "e"]')).toEqual([
      "a b",
      "c",
      "d",
    ]);
  });

  it("drops non-strings, blanks and overlong entries", () => {
    expect(parseFollowUps(`[1, "", "ok", "${"x".repeat(200)}"]`)).toEqual([
      "ok",
    ]);
  });

  it("returns nothing for a reply that isn't an array", () => {
    expect(parseFollowUps("[]")).toEqual([]);
    expect(parseFollowUps("No follow-ups.")).toEqual([]);
    expect(parseFollowUps("[not json")).toEqual([]);
  });
});
