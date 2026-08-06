import type { RawCapture } from "./types";
import { describe, expect, it } from "vitest";
import rawIos from "./__fixtures__/raw-ios-capture.json";
import { normalizeCapture } from "./normalize";

describe("normalizeCapture — single window", () => {
  it("uses the lone window as the root", () => {
    const capture = normalizeCapture(rawIos as unknown as RawCapture);
    expect(capture.hierarchy.id).toBe("0x1");
    expect(capture.hierarchy.class).toBe("UIWindow");
    expect(capture.hierarchy.children).toHaveLength(1);

    const child = capture.hierarchy.children[0];
    expect(child.id).toBe("0x2");
    expect(child.class).toBe("UIButton");
    expect(child.title).toBe("Sign In");
    expect(child.backgroundColor).toBe("#007AFFFF");
    expect(child.accessibilityIdentifier).toBe("btn_sign_in");
    expect(child.absFrame).toEqual({ x: 24, y: 300, w: 342, h: 50 });
  });

  it("carries nodeCount and screenshot through", () => {
    const capture = normalizeCapture(rawIos as unknown as RawCapture);
    expect(capture.nodeCount).toBe(2);
    expect(capture.screenshot?.encoding).toBe("png");
    expect(capture.device.platform).toBe("ios");
  });
});

describe("normalizeCapture — multiple windows", () => {
  const raw: RawCapture = {
    capturedAt: "2026-04-22T10:00:00Z",
    device: { platform: "ios", deviceId: "sim", width: 390, height: 844 },
    inspect: {
      status: "ok",
      nodeCount: 2,
      windows: [
        {
          id: "0xA",
          class: "UIWindow",
          depth: 0,
          frame: { x: 0, y: 0, w: 390, h: 844 },
          children: [],
        },
        {
          id: "0xB",
          class: "UITextEffectsWindow",
          depth: 0,
          frame: { x: 0, y: 0, w: 390, h: 844 },
          children: [],
        },
      ] as unknown[],
    },
  };

  it("wraps them under a synthetic root sized to the device", () => {
    const capture = normalizeCapture(raw);
    expect(capture.hierarchy.id).toBe("windows");
    expect(capture.hierarchy.frame).toEqual({ x: 0, y: 0, w: 390, h: 844 });
    expect(capture.hierarchy.children).toHaveLength(2);
    expect(capture.hierarchy.children[1].class).toBe("UITextEffectsWindow");
  });
});

describe("normalizeCapture — degenerate input", () => {
  it("returns an empty synthetic root when there are no windows", () => {
    const raw: RawCapture = {
      capturedAt: "2026-04-22T10:00:00Z",
      device: { platform: "ios", deviceId: "broken", width: 100, height: 200 },
      inspect: { status: "ok", windows: [] },
    };
    const capture = normalizeCapture(raw);
    expect(capture.hierarchy.children).toEqual([]);
    expect(capture.hierarchy.frame).toEqual({ x: 0, y: 0, w: 100, h: 200 });
    expect(capture.screenshot).toBeUndefined();
  });

  it("fills missing children arrays so the tree is always walkable", () => {
    const raw: RawCapture = {
      capturedAt: "2026-04-22T10:00:00Z",
      device: { platform: "tvos", deviceId: "atv", width: 1920, height: 1080 },
      inspect: {
        windows: [
          {
            id: "0x1",
            class: "UIWindow",
            frame: { x: 0, y: 0, w: 1920, h: 1080 },
          },
        ] as unknown[],
      },
    };
    const capture = normalizeCapture(raw);
    expect(capture.hierarchy.children).toEqual([]);
    expect(capture.hierarchy.depth).toBe(0);
  });
});
