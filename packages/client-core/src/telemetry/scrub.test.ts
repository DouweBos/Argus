import { describe, expect, it } from "vitest";
import { SCRUBBED_MAX_LENGTH, scrubMessage, scrubStack } from "./scrub";

describe("scrubMessage", () => {
  it("drops home directories and container paths", () => {
    expect(scrubMessage("ENOENT: /Users/douwe/Work/app and /home/me/x")).toBe(
      "ENOENT: /Users/<user>/Work/app and /home/<user>/x",
    );
    expect(scrubMessage("C:\\Users\\Ann\\repo")).toBe(
      "C:\\Users\\<user>\\repo",
    );
    expect(scrubMessage("at /private/var/folders/ab/T/x")).toBe(
      "at /private/var/<path>",
    );
  });

  it("caps the length", () => {
    expect(scrubMessage("a".repeat(5000))).toHaveLength(SCRUBBED_MAX_LENGTH);
  });
});

describe("scrubStack", () => {
  it("keeps the frame and drops the origin and query", () => {
    expect(
      scrubStack(
        "Error: x\n    at f (https://192.168.1.4:7341/assets/index-abc.js?v=1:10:5)",
      ),
    ).toBe("Error: x\n    at f (/assets/index-abc.js:10:5)");
  });
});
