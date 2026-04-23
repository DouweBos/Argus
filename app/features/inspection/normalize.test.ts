import type { RawCapture } from "./types";
import { describe, expect, it } from "vitest";
import rawIos from "./__fixtures__/raw-ios-capture.json";
import { normalizeCapture } from "./normalize";

describe("normalizeCapture — iOS envelope", () => {
  it("unwraps hierarchy.axElement into a uniform root", () => {
    const capture = normalizeCapture(rawIos as unknown as RawCapture);
    expect(capture.hierarchy.id).toBe("0");
    expect(capture.hierarchy.type).toBe("Window");
    expect(capture.hierarchy.children).toHaveLength(1);

    const child = capture.hierarchy.children[0];
    expect(child.id).toBe("0.0");
    expect(child.type).toBe("UIButton");
    expect(child.label).toBe("Sign In");
    expect(child.identifier).toBe("btn_sign_in");
    expect(child.frame).toEqual({ x: 24, y: 300, w: 342, h: 50 });
    expect(child.state).toEqual({
      enabled: true,
      selected: false,
      focused: false,
    });
  });

  it("passes a11ySnapshot through unchanged", () => {
    const capture = normalizeCapture(rawIos as unknown as RawCapture);
    expect(capture.a11ySnapshot).toHaveLength(1);
    expect(capture.a11ySnapshot[0].nodeId).toBe("0.0");
  });
});

describe("normalizeCapture — Android envelope", () => {
  const raw: RawCapture = {
    version: 1,
    capturedAt: "2026-04-22T10:00:00Z",
    device: {
      platform: "android",
      deviceId: "emulator-5554",
      width: 1080,
      height: 2400,
    },
    screenshot: { kind: "composite", encoding: "png", data: "" },
    capabilities: { perViewPixels: false, depthData: false },
    a11ySnapshot: [],
    hierarchy: {
      xml: "<hierarchy/>",
      elements: [
        {
          nodeId: "0",
          class: "android.widget.Button",
          bounds: { x1: 48, y1: 600, x2: 1032, y2: 700 },
          text: "Submit",
          resourceId: "com.example:id/submit",
          state: { enabled: true, selected: false, focused: false },
          accessibilityOrder: 0,
        },
      ],
    },
  };

  it("unwraps a single-element array without a synthetic root", () => {
    const capture = normalizeCapture(raw);
    expect(capture.hierarchy.id).toBe("0");
    expect(capture.hierarchy.type).toBe("android.widget.Button");
    expect(capture.hierarchy.label).toBe("Submit");
    expect(capture.hierarchy.identifier).toBe("com.example:id/submit");
    expect(capture.hierarchy.frame).toEqual({ x: 48, y: 600, w: 984, h: 100 });
  });
});

describe("normalizeCapture — Web envelope", () => {
  const raw: RawCapture = {
    version: 1,
    capturedAt: "2026-04-22T10:00:00Z",
    device: {
      platform: "web",
      deviceId: "web-1",
      width: 1280,
      height: 800,
    },
    screenshot: { kind: "composite", encoding: "png", data: "" },
    capabilities: { perViewPixels: false, depthData: false },
    a11ySnapshot: [],
    hierarchy: {
      elements: [
        {
          nodeId: "0",
          role: "button",
          name: "Click me",
          bounds: { x: 10, y: 20, width: 100, height: 40 },
          state: { enabled: true, selected: false, focused: false },
        },
        {
          nodeId: "1",
          role: "link",
          name: "Docs",
          bounds: { x: 10, y: 80, width: 50, height: 20 },
          state: { enabled: true, selected: false, focused: false },
        },
      ],
    },
  };

  it("wraps multi-element arrays under a synthetic root sized to the device", () => {
    const capture = normalizeCapture(raw);
    expect(capture.hierarchy.id).toBe("root");
    expect(capture.hierarchy.type).toBe("div");
    expect(capture.hierarchy.frame).toEqual({ x: 0, y: 0, w: 1280, h: 800 });
    expect(capture.hierarchy.children).toHaveLength(2);
    expect(capture.hierarchy.children[0].label).toBe("Click me");
    expect(capture.hierarchy.children[0].frame).toEqual({
      x: 10,
      y: 20,
      w: 100,
      h: 40,
    });
  });
});

describe("normalizeCapture — missing envelope", () => {
  it("returns an empty synthetic root instead of crashing", () => {
    const raw: RawCapture = {
      version: 1,
      capturedAt: "2026-04-22T10:00:00Z",
      device: {
        platform: "ios",
        deviceId: "broken",
        width: 100,
        height: 200,
      },
      screenshot: { kind: "composite", encoding: "png", data: "" },
      capabilities: { perViewPixels: false, depthData: false },
      a11ySnapshot: [],
      hierarchy: {},
    };
    const capture = normalizeCapture(raw);
    expect(capture.hierarchy.children).toEqual([]);
    expect(capture.hierarchy.frame).toEqual({ x: 0, y: 0, w: 100, h: 200 });
  });
});
