// @vitest-environment jsdom
import type { DeviceClaimState } from "../../../hooks/useDeviceClaim";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { CanvasStreamBody } from "./CanvasStreamBody";

// jsdom has no pointer capture, and the pointer handlers call it outright.
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;

function renderBody(claim?: DeviceClaimState, rotation?: 0 | 90 | 180 | 270) {
  const onTouch = vi.fn();
  const onKeyDown = vi.fn();
  render(
    <CanvasStreamBody
      canvasRef={createRef<HTMLCanvasElement>()}
      claim={claim}
      isConfigured
      isReceiving
      rotation={rotation}
      videoHeight={800}
      videoWidth={400}
      onKeyDown={onKeyDown}
      onKeyUp={vi.fn()}
      onTouch={onTouch}
    />,
  );

  return { onTouch, onKeyDown };
}

/** jsdom reports zero-sized rects, so the surface needs a real box to hit. */
function sizeSurface(surface: HTMLElement, width: number, height: number) {
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height }) as DOMRect;
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

describe("canvasStreamBody rotation", () => {
  it("presents the stream at the panel's rotation", () => {
    renderBody(FREE, 90);

    expect(document.querySelector("canvas")!.dataset.rotation).toBe("90");
  });

  it("sends taps in stream coordinates when the view is upright", () => {
    const { onTouch } = renderBody(FREE, 0);
    const surface = document.querySelector("canvas")!.parentElement!;
    sizeSurface(surface, 400, 800);

    fireEvent.pointerDown(surface, { clientX: 100, clientY: 600, buttons: 1 });

    const [x, y] = onTouch.mock.calls[0]!;
    expect(x).toBeCloseTo(0.25);
    expect(y).toBeCloseTo(0.75);
  });

  it("un-rotates taps so they land where the user aimed", () => {
    const { onTouch } = renderBody(FREE, 90);
    // A quarter turn swaps the presented axes, so the box is 800x400.
    const surface = document.querySelector("canvas")!.parentElement!;
    sizeSurface(surface, 800, 400);

    fireEvent.pointerDown(surface, { clientX: 200, clientY: 200, buttons: 1 });

    const [x, y] = onTouch.mock.calls[0]!;
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(0.75);
  });

  it("flips both axes when the device is upside down", () => {
    const { onTouch } = renderBody(FREE, 180);
    const surface = document.querySelector("canvas")!.parentElement!;
    sizeSurface(surface, 400, 800);

    fireEvent.pointerDown(surface, { clientX: 100, clientY: 600, buttons: 1 });

    const [x, y] = onTouch.mock.calls[0]!;
    expect(x).toBeCloseTo(0.75);
    expect(y).toBeCloseTo(0.25);
  });
});
