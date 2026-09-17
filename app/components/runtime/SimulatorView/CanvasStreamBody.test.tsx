// @vitest-environment jsdom
import type { DeviceClaimState } from "../../../hooks/useDeviceClaim";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { CanvasStreamBody } from "./CanvasStreamBody";

// jsdom has no pointer capture, and the pointer handlers call it outright.
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;

function renderBody(claim?: DeviceClaimState) {
  const onTouch = vi.fn();
  const onKeyDown = vi.fn();
  render(
    <CanvasStreamBody
      canvasRef={createRef<HTMLCanvasElement>()}
      claim={claim}
      isConfigured
      isReceiving
      videoHeight={800}
      videoWidth={400}
      onKeyDown={onKeyDown}
      onKeyUp={vi.fn()}
      onTouch={onTouch}
    />,
  );

  return { onTouch, onKeyDown };
}

const takeControl = vi.fn();

const BLOCKED: DeviceClaimState = {
  blocked: true,
  holderLabel: "Douwe's iPhone",
  reportInputError: () => false,
  takeControl,
};

const FREE: DeviceClaimState = {
  blocked: false,
  holderLabel: null,
  reportInputError: () => false,
  takeControl,
};

describe("canvasStreamBody claim gating", () => {
  it("drops input and says who is driving while another client holds it", () => {
    const { onTouch, onKeyDown } = renderBody(BLOCKED);
    const surface = document.querySelector("canvas")!.parentElement!;

    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, buttons: 1 });
    fireEvent.pointerUp(surface, { clientX: 10, clientY: 10 });
    fireEvent.keyDown(surface.parentElement!, { key: "a" });

    expect(onTouch).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(screen.getByText("Controlled by Douwe's iPhone")).toBeTruthy();
  });

  it("offers the takeover", () => {
    renderBody(BLOCKED);

    fireEvent.click(screen.getByRole("button", { name: "Take control" }));

    expect(takeControl).toHaveBeenCalled();
  });

  it("lets input through once the claim is ours again", () => {
    const { onTouch } = renderBody(FREE);
    const surface = document.querySelector("canvas")!.parentElement!;

    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, buttons: 1 });

    expect(onTouch).toHaveBeenCalled();
    expect(screen.queryByText(/Controlled by/)).toBeNull();
  });
});
