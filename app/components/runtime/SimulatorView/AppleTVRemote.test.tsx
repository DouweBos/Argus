// @vitest-environment jsdom
/**
 * tvOS ignores the simulator bridge's keyboard-emulated remote, so the remote
 * prefers conductor's streaming input socket and only falls back to the bridge
 * when conductor can't serve the device.
 */

import type { InputCapabilities } from "../../../lib/deviceInputClient";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const simulatorButton =
  vi.fn<(udid: string, button: string) => Promise<void>>();
const tvremote = vi.fn<(button: string) => void>();

vi.mock("../../../lib/ipc", () => ({
  simulatorButton: (udid: string, button: string) =>
    simulatorButton(udid, button),
}));

let inputState: {
  capabilities: InputCapabilities | null;
  client: { tvremote: typeof tvremote } | null;
  ready: boolean;
};

vi.mock("../../../hooks/useDeviceInput", () => ({
  useDeviceInput: () => inputState,
}));

const { AppleTVRemote } = await import("./AppleTVRemote");

function capabilities(tvRemote: boolean): InputCapabilities {
  return {
    binaryPointer: false,
    buttons: ["menu", "select"],
    coord: "normalized",
    drag: true,
    keyboard: true,
    liveDrag: "buffered",
    multitouch: true,
    springboard: true,
    text: true,
    touch: true,
    tvRemote,
  };
}

describe("apple tv remote", () => {
  beforeEach(() => {
    simulatorButton.mockReset();
    simulatorButton.mockResolvedValue(undefined);
    tvremote.mockReset();
    inputState = { capabilities: null, client: null, ready: false };
  });

  it("sends the remote through conductor once its socket is ready", () => {
    inputState = {
      capabilities: capabilities(true),
      client: { tvremote },
      ready: true,
    };
    render(<AppleTVRemote udid="udid-1" />);

    fireEvent.pointerDown(screen.getByText("Menu"));

    expect(tvremote).toHaveBeenCalledWith("menu");
    expect(simulatorButton).not.toHaveBeenCalled();
  });

  it("spells play/pause the way conductor does", () => {
    inputState = {
      capabilities: capabilities(true),
      client: { tvremote },
      ready: true,
    };
    render(<AppleTVRemote udid="udid-1" />);

    fireEvent.pointerDown(screen.getByText("▶❚❚"));

    expect(tvremote).toHaveBeenCalledWith("playPause");
  });

  it("falls back to the bridge when conductor has no socket", () => {
    render(<AppleTVRemote udid="udid-1" />);

    fireEvent.pointerDown(screen.getByText("Menu"));

    expect(simulatorButton).toHaveBeenCalledWith("udid-1", "menu");
    expect(tvremote).not.toHaveBeenCalled();
  });

  it("falls back when the socket is up but advertises no tv remote", () => {
    inputState = {
      capabilities: capabilities(false),
      client: { tvremote },
      ready: true,
    };
    render(<AppleTVRemote udid="udid-1" />);

    fireEvent.pointerDown(screen.getByText("Menu"));

    expect(simulatorButton).toHaveBeenCalledWith("udid-1", "menu");
    expect(tvremote).not.toHaveBeenCalled();
  });

  it("sends nothing at all while another host holds the device", () => {
    inputState = {
      capabilities: capabilities(true),
      client: { tvremote },
      ready: true,
    };
    render(<AppleTVRemote claim={{ blocked: true } as never} udid="udid-1" />);

    fireEvent.pointerDown(screen.getByText("Menu"));

    expect(tvremote).not.toHaveBeenCalled();
    expect(simulatorButton).not.toHaveBeenCalled();
  });
});
