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

  it("accepts older file links and whole-file links", () => {
    expect(parseFigmaUrl("https://figma.com/file/Key9/Name")).toEqual({
      fileKey: "Key9",
      nodeId: null,
    });
  });

  it("rejects other URLs", () => {
    expect(parseFigmaUrl("https://example.com/design/abc")).toBeNull();
    expect(parseFigmaUrl("not a url")).toBeNull();
  });
});
