// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteDeviceState } from "../lib/protocol";
import { DeviceScreen } from "./DeviceScreen";

const setDeviceOrientation = vi.fn().mockResolvedValue(undefined);
const setDeviceFold = vi.fn().mockResolvedValue(undefined);
const loadDeviceState = vi.fn().mockResolvedValue(undefined);
const deviceButton = vi.fn().mockResolvedValue(undefined);
const claimDevice = vi.fn().mockResolvedValue(undefined);
const releaseDevice = vi.fn();

let claimByDevice: Record<string, { connection_id: string; label: string } | null> = {};
let claimConnectionId: string | null = null;

let deviceState: RemoteDeviceState = {
  device_id: "sim-1",
  fold: null,
  orientation: "portrait",
  display: { width: 390, height: 844, rotation: 0, screen_id: 0 },
};

vi.mock("@argus/remote-client", () => ({
  H264CanvasDecoder: class {
    static supported = true;
    attachCanvas() {}
    configure() {}
    decode() {}
    close() {}
  },
}));

vi.mock("../lib/store", () => ({
  useAppStore: (select: (s: unknown) => unknown) =>
    select({
      connection: "ready",
      hasControl: () => true,
      watchDevice: vi.fn().mockResolvedValue(1),
      unwatchDevice: vi.fn().mockResolvedValue(undefined),
      registerMediaSink: () => () => {},
      deviceTouch: vi.fn(),
      deviceButton,
      deviceKeyboard: vi.fn(),
      claimByDevice,
      claimConnectionId,
      loadClaim: vi.fn().mockResolvedValue(undefined),
      claimDevice,
      releaseDevice,
      loadDeviceState,
      setDeviceOrientation,
      setDeviceFold,
      deviceStateById: { "sim-1": deviceState },
    }),
}));

beforeEach(() => {
  deviceButton.mockClear();
  setDeviceOrientation.mockClear();
  setDeviceFold.mockClear();
  claimDevice.mockClear();
  releaseDevice.mockClear();
  claimByDevice = {};
  claimConnectionId = null;
});

function renderScreen() {
  return render(
    <DeviceScreen deviceId="sim-1" platform="ios" isTv={false} />,
  );
}

describe("the device screen's pose controls", () => {
  beforeEach(() => {
    deviceState = {
      device_id: "sim-1",
      fold: null,
      orientation: "portrait",
      display: { width: 390, height: 844, rotation: 0, screen_id: 0 },
    };
  });

  it("rotates a quarter turn from wherever the device is now", () => {
    deviceState = { ...deviceState, orientation: "landscapeLeft" };
    renderScreen();

    fireEvent.click(screen.getByLabelText("Rotate device"));

    expect(setDeviceOrientation).toHaveBeenCalledWith(
      "sim-1",
      "ios",
      "portraitUpsideDown",
    );
  });

  it("offers no hinge on a device that has none", () => {
    renderScreen();

    expect(screen.queryByLabelText("Fold device")).toBeNull();
  });

  it("shuts an open foldable", () => {
    deviceState = { ...deviceState, fold: { angle: 180, pose: "open" } };
    renderScreen();

    fireEvent.click(screen.getByLabelText("Fold device"));

    expect(setDeviceFold).toHaveBeenCalledWith("sim-1", "ios", "closed");
  });

  it("presents the stream at the device's own rotation", () => {
    deviceState = {
      ...deviceState,
      orientation: "landscapeLeft",
      display: { width: 390, height: 844, rotation: 90, screen_id: 0 },
    };
    const { container } = renderScreen();

    expect(container.querySelector("canvas")?.dataset.rotation).toBe("90");
  });
});

describe("a tvOS device", () => {
  /** jsdom lays nothing out, so the pad needs a box before it can be aimed at. */
  function clickpadIn(container: HTMLElement): HTMLElement {
    const pad = container.querySelector<HTMLElement>("[class*='clickpad']")!;
    pad.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 96, height: 96 }) as DOMRect;

    return pad;
  }

  it("presses Select from the centre of the pad", () => {
    const { container } = render(
      <DeviceScreen deviceId="sim-1" platform="ios" isTv />,
    );

    fireEvent.pointerDown(clickpadIn(container), { clientX: 48, clientY: 48 });

    expect(deviceButton).toHaveBeenCalledWith("sim-1", "ios", "select");
  });

  it("presses Right from the pad's right edge", () => {
    const { container } = render(
      <DeviceScreen deviceId="sim-1" platform="ios" isTv />,
    );

    fireEvent.pointerDown(clickpadIn(container), { clientX: 92, clientY: 48 });

    expect(deviceButton).toHaveBeenCalledWith("sim-1", "ios", "right");
  });
});

describe("the device claim bar", () => {
  it("offers control of a device nobody is driving", () => {
    renderScreen();

    expect(screen.getByText("Nobody is driving")).toBeTruthy();

    fireEvent.click(screen.getByText("Take control"));

    // Nothing to steal, so no forced takeover.
    expect(claimDevice).toHaveBeenCalledWith("sim-1", false);
  });

  it("hands a held device back rather than sitting on it until it idles out", () => {
    claimConnectionId = "conn-1";
    claimByDevice = { "sim-1": { connection_id: "conn-1", label: "Ana" } };
    renderScreen();

    expect(screen.getByText("You're driving")).toBeTruthy();

    fireEvent.click(screen.getByText("Hand back"));

    expect(releaseDevice).toHaveBeenCalledWith("sim-1");
  });

  it("names the driver and takes over explicitly when it is someone else", () => {
    claimConnectionId = "conn-1";
    claimByDevice = { "sim-1": { connection_id: "conn-2", label: "Ana" } };
    renderScreen();

    expect(screen.getByText("Ana is driving")).toBeTruthy();

    // The blocking scrim offers the same takeover; the bar's is the first.
    fireEvent.click(screen.getAllByText("Take control")[0]!);

    expect(claimDevice).toHaveBeenCalledWith("sim-1", true);
  });
});
