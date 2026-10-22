import { describe, expect, it } from "vitest";
import { baseBranchOptions, pickDefaultBaseBranch } from "./baseBranch";

describe("pickDefaultBaseBranch", () => {
  it("prefers the configured default base", () => {
    expect(
      pickDefaultBaseBranch(["main", "release"], [], "release", [], null),
    ).toBe("release");
  });

  it("takes the origin ref when the project root has that branch out", () => {
    expect(
      pickDefaultBaseBranch(["main"], ["origin/main"], null, [], "main"),
    ).toBe("origin/main");
  });

  it("takes the local branch when the project root is elsewhere", () => {
    expect(
      pickDefaultBaseBranch(["main"], ["origin/main"], null, [], "feature"),
    ).toBe("main");
  });

  it("falls back to the first local branch", () => {
    expect(pickDefaultBaseBranch(["topic"], [], null, [], null)).toBe("topic");
    expect(pickDefaultBaseBranch([], [], null, [], null)).toBeNull();
  });
});

describe("baseBranchOptions", () => {
  it("keeps local branches and only base-like origin refs", () => {
    expect(
      baseBranchOptions(
        ["main", "topic"],
        ["origin/main", "origin/topic", "origin/release"],
        ["release"],
      ),
    ).toEqual(["main", "topic", "origin/main", "origin/release"]);
  });
});
