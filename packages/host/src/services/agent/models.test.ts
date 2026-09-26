import { describe, expect, it } from "vitest";
import { resultSubtype } from "./models";

describe("resultSubtype", () => {
  it("treats an is_error success as an error", () => {
    expect(resultSubtype({ subtype: "success", is_error: true })).toBe("error");
  });

  it("maps the CLI's error_* subtypes to error", () => {
    expect(resultSubtype({ subtype: "error_max_turns" })).toBe("error");
    expect(resultSubtype({ subtype: "error_during_execution" })).toBe("error");
  });

  it("keeps a clean success", () => {
    expect(resultSubtype({ subtype: "success", is_error: false })).toBe(
      "success",
    );
    expect(resultSubtype({})).toBe("success");
  });
});
