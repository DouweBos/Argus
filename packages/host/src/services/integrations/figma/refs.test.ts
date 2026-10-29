import { describe, expect, it } from "vitest";
import { parseFigmaUrl } from "./refs";

describe("parseFigmaUrl", () => {
  it("reads the file key and converts the node id", () => {
    expect(
      parseFigmaUrl(
        "https://www.figma.com/design/AbC123/My-App?node-id=12-34&t=x",
      ),
    ).toEqual({ fileKey: "AbC123", nodeId: "12:34" });
  });

  it("converts every separator in nested instance ids", () => {
    expect(
      parseFigmaUrl("https://www.figma.com/design/K/App?node-id=I1-2;3-4")
        ?.nodeId,
    ).toBe("I1:2;3:4");
  });

  it("accepts older file links and whole-file links", () => {
    expect(parseFigmaUrl("https://figma.com/file/Key9/Name")).toEqual({
      fileKey: "Key9",
      nodeId: null,
    });
  });

  it("reads branch links from the branch file", () => {
    expect(
      parseFigmaUrl(
        "https://www.figma.com/design/MainKey1/branch/BranchKey2/My-App?m=auto&node-id=19039-31365",
      ),
    ).toEqual({ fileKey: "BranchKey2", nodeId: "19039:31365" });
    expect(
      parseFigmaUrl(
        "https://www.figma.com/design/MainKey1/branch/BranchKey2/My-App",
      ),
    ).toEqual({ fileKey: "BranchKey2", nodeId: null });
  });

  it("keeps the file key for plain design links", () => {
    expect(
      parseFigmaUrl(
        "https://www.figma.com/design/MainKey1/branch-notes?node-id=1-2",
      ),
    ).toEqual({ fileKey: "MainKey1", nodeId: "1:2" });
  });

  it("rejects other URLs", () => {
    expect(parseFigmaUrl("https://example.com/design/abc")).toBeNull();
    expect(parseFigmaUrl("not a url")).toBeNull();
  });
});
