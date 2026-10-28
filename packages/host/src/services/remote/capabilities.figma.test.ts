/**
 * Figma over the wire: the design viewer's frame details and the compare
 * against a device are reads, so monitor, and never handed to a guest.
 */

import type { GatewayContext } from "./capabilities";
import type { PairedDevice } from "./deviceStore";
import {
  MethodResult,
  METHOD_SCOPE,
  REMOTE_METHODS,
} from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentPendingPermissions: new Map(),
    sessions: new Map(),
  },
}));
vi.mock("../integrations/figma/service", () => ({
  figmaFrameDetails: vi.fn(),
}));
vi.mock("../design/compare", () => ({
  compareToDesign: vi.fn(),
}));
vi.mock("../simulator/screenshot", () => ({
  devicePng: vi.fn(),
}));

const { dispatch } = await import("./capabilities");
const figma = vi.mocked(await import("../integrations/figma/service"));
const compare = vi.mocked(await import("../design/compare"));
const screenshot = vi.mocked(await import("../simulator/screenshot"));

const URL = "https://www.figma.com/design/abc/App?node-id=1-2";

const DETAILS = {
  ref: { url: URL, fileKey: "abc", nodeId: "1:2", name: "Login", version: "9" },
  frame: { name: "Login", image: "iVBO", width: 390, height: 844 },
  layers: [
    {
      id: "1:3",
      name: "Title",
      type: "TEXT",
      depth: 1,
      width: 200,
      height: 24,
      text: "Welcome",
      fill: "#111111",
      font: "Inter 600 16/24",
    },
  ],
  comments: [{ author: "Ann", body: "Bigger title" }],
  file: { name: "App", version: "9", lastModified: 0 },
  pages: [{ name: "Screens", frames: [{ name: "Login", url: URL }] }],
};

function ctx(capabilities: PairedDevice["capabilities"]): GatewayContext {
  return {
    device: {
      device_id: "dev-1",
      label: "Phone",
      dev_static_pub: "",
      capabilities,
      created_at: 0,
      last_seen: null,
    },
    connectionId: "conn-1",
    outstandingPermissions: new Set(),
  };
}

describe("figma over the wire", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads at monitor and never to a scoped grant", () => {
    for (const method of ["figma.frame_details", "design.compare"] as const) {
      expect(REMOTE_METHODS[method]).toBe("monitor");
      expect(METHOD_SCOPE[method].kind).toBe("denied");
    }
  });

  it("returns a frame's details", async () => {
    figma.figmaFrameDetails.mockResolvedValue(DETAILS);

    const res = await dispatch(
      "figma.frame_details",
      { url: URL },
      ctx(["monitor"]),
    );

    expect(figma.figmaFrameDetails).toHaveBeenCalledWith(URL);
    expect(MethodResult["figma.frame_details"].parse(res)).toEqual({
      details: DETAILS,
    });
  });

  it("answers null for a link that isn't a frame", async () => {
    figma.figmaFrameDetails.mockResolvedValue(null);

    const res = await dispatch(
      "figma.frame_details",
      { url: "https://example.com" },
      ctx(["monitor"]),
    );

    expect(res).toEqual({ details: null });
  });

  it("compares the frame against the device's screenshot", async () => {
    const png = Buffer.from("png");
    screenshot.devicePng.mockResolvedValue(png);
    const comparison = {
      differingFraction: 0.04,
      width: 2,
      height: 2,
      design: "d",
      screenshot: "s",
      diff: "x",
    };
    compare.compareToDesign.mockResolvedValue(comparison);

    const res = await dispatch(
      "design.compare",
      { url: URL, platform: "ios", device_key: "UDID" },
      ctx(["monitor"]),
    );

    expect(screenshot.devicePng).toHaveBeenCalledWith("ios", "UDID");
    expect(compare.compareToDesign).toHaveBeenCalledWith(URL, png, "app");
    expect(MethodResult["design.compare"].parse(res)).toEqual({ comparison });
  });

  it("says so when the device can't be screenshotted", async () => {
    screenshot.devicePng.mockResolvedValue(null);

    await expect(
      dispatch(
        "design.compare",
        { url: URL, platform: "ios", device_key: "UDID" },
        ctx(["monitor"]),
      ),
    ).rejects.toThrow(/screenshot/);
    expect(compare.compareToDesign).not.toHaveBeenCalled();
  });

  it("turns the compare's thrown sentence into the error", async () => {
    screenshot.devicePng.mockResolvedValue(Buffer.from("png"));
    compare.compareToDesign.mockRejectedValue(
      `"${URL}" isn't a Figma frame Argus can render.`,
    );

    await expect(
      dispatch(
        "design.compare",
        { url: URL, platform: "ios", device_key: "UDID" },
        ctx(["monitor"]),
      ),
    ).rejects.toThrow(/isn't a Figma frame/);
  });
});
