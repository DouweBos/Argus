import { describe, expect, it } from "vitest";
import { fileIconColor, fileExtLabel } from "./fileIcons";
import { workspaceStatusLabel, isWorkspaceReady } from "./types";
import { md5Hex } from "./md5";

describe("fileIconColor", () => {
  it("returns TypeScript blue for .ts", () => {
    expect(fileIconColor("ts")).toBe("#3178c6");
  });

  it("returns JavaScript yellow for .js", () => {
    expect(fileIconColor("js")).toBe("#f0db4f");
  });

  it("returns default gray for unknown extensions", () => {
    expect(fileIconColor("xyz")).toBe("#808080");
  });

  it("handles all CSS variants", () => {
    expect(fileIconColor("css")).toBe("#563d7c");
    expect(fileIconColor("scss")).toBe("#563d7c");
    expect(fileIconColor("less")).toBe("#563d7c");
  });
});

describe("fileExtLabel", () => {
  it("returns 'TS' for TypeScript", () => {
    expect(fileExtLabel("ts")).toBe("TS");
  });

  it("returns 'TX' for TSX", () => {
    expect(fileExtLabel("tsx")).toBe("TX");
  });

  it("returns '{}' for JSON", () => {
    expect(fileExtLabel("json")).toBe("{}");
  });

  it("returns '<>' for HTML", () => {
    expect(fileExtLabel("html")).toBe("<>");
  });

  it("truncates unknown extensions to 2 chars", () => {
    expect(fileExtLabel("dockerfile")).toBe("DO");
  });

  it("returns placeholder for empty extension", () => {
    expect(fileExtLabel("")).toBe("··");
  });
});

describe("workspaceStatusLabel", () => {
  it("returns string status as-is", () => {
    expect(workspaceStatusLabel("ready")).toBe("ready");
    expect(workspaceStatusLabel("initializing")).toBe("initializing");
  });

  it("returns 'error' for error objects", () => {
    expect(workspaceStatusLabel({ error: "something broke" })).toBe("error");
  });
});

describe("isWorkspaceReady", () => {
  it("returns true for 'ready'", () => {
    expect(isWorkspaceReady("ready")).toBe(true);
  });

  it("returns false for 'initializing'", () => {
    expect(isWorkspaceReady("initializing")).toBe(false);
  });

  it("returns false for error status", () => {
    expect(isWorkspaceReady({ error: "fail" })).toBe(false);
  });
});

describe("md5Hex", () => {
  it("produces a 32-char hex string", () => {
    const result = md5Hex("hello");
    expect(result).toHaveLength(32);
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces known digest for empty string", () => {
    // MD5("") = d41d8cd98f00b204e9800998ecf8427e
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("is deterministic", () => {
    expect(md5Hex("test")).toBe(md5Hex("test"));
  });

  it("produces different hashes for different inputs", () => {
    expect(md5Hex("a")).not.toBe(md5Hex("b"));
  });
});
