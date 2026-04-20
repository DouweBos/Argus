import { describe, expect, it } from "vitest";
import { fileExtLabel, fileIconColor } from "./fileIcons";

describe("fileIconColor", () => {
  it("returns the TS brand color for ts/tsx", () => {
    expect(fileIconColor("ts")).toBe("#3178c6");
    expect(fileIconColor("tsx")).toBe("#3178c6");
  });

  it("returns the JS brand color for js family", () => {
    for (const ext of ["js", "jsx", "mjs", "cjs"]) {
      expect(fileIconColor(ext)).toBe("#f0db4f");
    }
  });

  it("returns the fallback gray for unknown extensions", () => {
    expect(fileIconColor("")).toBe("#808080");
    expect(fileIconColor("xyzzy")).toBe("#808080");
  });
});

describe("fileExtLabel", () => {
  it("returns two-letter labels for common web extensions", () => {
    expect(fileExtLabel("ts")).toBe("TS");
    expect(fileExtLabel("tsx")).toBe("TX");
    expect(fileExtLabel("jsx")).toBe("JX");
    expect(fileExtLabel("json")).toBe("{}");
    expect(fileExtLabel("html")).toBe("<>");
  });

  it("groups shell extensions under SH", () => {
    for (const ext of ["sh", "bash", "zsh"]) {
      expect(fileExtLabel(ext)).toBe("SH");
    }
  });

  it("derives a 2-char uppercase label for unknowns", () => {
    expect(fileExtLabel("proto")).toBe("PR");
    expect(fileExtLabel("a")).toBe("A");
  });

  it("returns a placeholder for empty input", () => {
    expect(fileExtLabel("")).toBe("··");
  });
});
