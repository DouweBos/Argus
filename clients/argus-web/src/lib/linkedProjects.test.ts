import { describe, expect, it } from "vitest";
import {
  buildLinkedProjectsPreamble,
  parseLinkedProjectsPreamble,
} from "./linkedProjects";

describe("the linked-projects preamble", () => {
  it("round-trips, so editing a queued message keeps its links", () => {
    const paths = ["/Users/dev/api", "/Users/dev/web"];
    const built = buildLinkedProjectsPreamble(paths, "fix the login screen");

    expect(parseLinkedProjectsPreamble(built)).toEqual({
      paths,
      rest: "fix the login screen",
    });
  });

  it("leaves a message with no links untouched", () => {
    const plain = "fix the login screen";

    expect(buildLinkedProjectsPreamble([], plain)).toBe(plain);
    expect(parseLinkedProjectsPreamble(plain)).toBeNull();
  });

  it("treats text that merely mentions brackets as plain", () => {
    expect(parseLinkedProjectsPreamble("[not a preamble] do the thing")).toBeNull();
  });
});
