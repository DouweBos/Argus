import { describe, expect, it } from "vitest";
import { fromCaptureUi } from "./pickCapture";

interface Shaped {
  device: { platform: string; width: number };
  inspect: {
    nodeCount: number;
    windows: {
      absFrame: { h: number; w: number; x: number; y: number };
      accessibilityIdentifier?: string;
      accessibilityLabel?: string;
      children: { class: string; id: string; text?: string }[];
      class: string;
      id: string;
    }[];
  };
  screenshot?: { data?: string };
}

describe("fromCaptureUi", () => {
  it("reshapes an XCUITest tree, skipping the frameless root", () => {
    const out = fromCaptureUi({
      device: { platform: "ios", width: 390, height: 844 },
      screenshot: { kind: "composite", encoding: "png", data: "AAAA" },
      hierarchy: {
        axElement: {
          elementType: 0,
          frame: { X: 0, Y: 0, Width: 0, Height: 0 },
          children: [
            {
              nodeId: "0.0",
              elementType: 2,
              label: "Settings",
              frame: { X: 0, Y: 0, Width: 390, Height: 844 },
              children: [
                {
                  nodeId: "0.0.0",
                  elementType: 9,
                  identifier: "save",
                  title: "Save",
                  frame: { X: 16, Y: 100, Width: 80, Height: 44 },
                },
              ],
            },
          ],
        },
      },
    }) as Shaped;
    const [window] = out.inspect.windows;
    expect(window.class).toBe("Application");
    expect(window.absFrame).toEqual({ x: 0, y: 0, w: 390, h: 844 });
    expect(window.children[0]).toMatchObject({
      id: "0.0.0",
      class: "Button",
      text: "Save",
    });
    expect(out.inspect.nodeCount).toBe(2);
    expect(out.screenshot?.data).toBe("AAAA");
  });

  it("reshapes a uiautomator tree from its bounds", () => {
    const out = fromCaptureUi({
      device: { platform: "android", width: 1080, height: 2400 },
      hierarchy: {
        elements: [
          {
            nodeId: "0",
            class: "android.widget.FrameLayout",
            resourceId: "android:id/content",
            contentDescription: "Root",
            bounds: { x1: 0, y1: 0, x2: 1080, y2: 2400 },
            children: [
              {
                nodeId: "0.0",
                class: "android.widget.TextView",
                text: "Network",
                bounds: { x1: 210, y1: 678, x2: 646, y2: 749 },
              },
            ],
          },
        ],
      },
    }) as Shaped;
    const [root] = out.inspect.windows;
    expect(root).toMatchObject({
      class: "android.widget.FrameLayout",
      accessibilityIdentifier: "android:id/content",
      accessibilityLabel: "Root",
    });
    expect(root.children[0]).toMatchObject({
      class: "android.widget.TextView",
      text: "Network",
    });
    expect(out.device.platform).toBe("android");
  });
});
