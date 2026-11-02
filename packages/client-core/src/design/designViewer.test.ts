import { describe, expect, it } from "vitest";
import {
  designChangedSince,
  designSubtitle,
  figmaFrameKey,
  formatDiffering,
  isFigmaUrl,
  sessionRefFor,
} from "./designViewer";

const ref = {
  url: "https://www.figma.com/design/AbC/App?node-id=12-34",
  fileKey: "AbC",
  nodeId: "12:34",
  name: "Checkout",
  version: "100",
};

describe("isFigmaUrl", () => {
  it("accepts file and frame links only", () => {
    expect(isFigmaUrl(ref.url)).toBe(true);
    expect(isFigmaUrl("https://figma.com/file/AbC")).toBe(true);
    expect(isFigmaUrl("https://www.figma.com/settings")).toBe(false);
    expect(isFigmaUrl("https://example.com/design/AbC")).toBe(false);
  });
});

describe("figmaFrameKey", () => {
  it("ignores the extra query a share link carries", () => {
    expect(figmaFrameKey(`${ref.url}&t=xyz`)).toBe("AbC:12:34");
    expect(figmaFrameKey("https://www.figma.com/file/AbC/App")).toBe("AbC:");
  });
});

describe("sessionRefFor", () => {
  it("finds the session's ref for the same frame", () => {
    const shown = { ...ref, url: `${ref.url}&t=1` };
    expect(sessionRefFor([ref], shown)).toBe(ref);
    expect(
      sessionRefFor([ref], { ...shown, nodeId: "1:1", url: "x" }),
    ).toBeNull();
    expect(sessionRefFor(null, ref)).toBeNull();
  });
});

describe("designChangedSince", () => {
  it("compares versions only when one was captured", () => {
    expect(designChangedSince(ref, "100")).toBe(false);
    expect(designChangedSince(ref, "101")).toBe(true);
    expect(designChangedSince({ ...ref, version: null }, "101")).toBe(false);
    expect(designChangedSince(null, "101")).toBe(false);
  });
});

describe("formatDiffering", () => {
  it("keeps one decimal below ten percent", () => {
    expect(formatDiffering(0.042)).toBe("4.2%");
    expect(formatDiffering(0)).toBe("0.0%");
    expect(formatDiffering(0.256)).toBe("26%");
  });
});

describe("designSubtitle", () => {
  it("names the file and when it was edited", () => {
    const subtitle = designSubtitle({
      file: {
        name: "App",
        version: "1",
        lastModified: Date.UTC(2026, 2, 4, 12),
      },
    } as Parameters<typeof designSubtitle>[0]);
    expect(subtitle).toMatch(/^App · Edited .*2026$/);
  });
});
