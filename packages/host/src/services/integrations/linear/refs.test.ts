import { describe, expect, it } from "vitest";
import { parseLinearRef } from "./refs";

describe("parseLinearRef", () => {
  it("accepts a bare identifier in any case", () => {
    expect(parseLinearRef("ENG-123")).toBe("ENG-123");
    expect(parseLinearRef(" eng-7 ")).toBe("ENG-7");
  });

  it("pulls the identifier out of an issue URL", () => {
    expect(
      parseLinearRef("https://linear.app/acme/issue/ENG-123/fix-the-login"),
    ).toBe("ENG-123");
    expect(parseLinearRef("https://linear.app/acme/issue/ab2-9")).toBe("AB2-9");
  });

  it("rejects anything else", () => {
    expect(parseLinearRef("fix the login")).toBeNull();
    expect(parseLinearRef("https://linear.app/acme/project/foo")).toBeNull();
    expect(parseLinearRef("https://example.com/issue/ENG-1")).toBeNull();
    expect(parseLinearRef("123-ENG")).toBeNull();
  });
});
