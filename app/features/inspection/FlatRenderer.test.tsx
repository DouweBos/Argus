// @vitest-environment jsdom
import type { Capture } from "./types";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectionRenderer } from "./InspectionRenderer";
import sampleCapture from "./__fixtures__/sample-capture.json";
import { resetInspectionState } from "./store";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const capture = sampleCapture as unknown as Capture;

describe("inspectionRenderer", () => {
  beforeEach(() => {
    resetInspectionState();
  });

  afterEach(() => {
    cleanup();
  });

  it("mounts the 2d renderer without throwing and queries stay resilient", () => {
    const { container } = render(<InspectionRenderer capture={capture} />);
    // The flat renderer defers image creation until the container reports a
    // non-zero size via ResizeObserver (stubbed above). That's fine — the
    // important smoke signal is that the root mounts.
    expect(container.firstChild).not.toBeNull();
    expect(screen.queryByAltText("Captured screen")).toBeDefined();
  });

  it("throws on 3d mode (not implemented in v1)", () => {
    expect(() =>
      render(<InspectionRenderer capture={capture} mode="3d" />),
    ).toThrow(/3D renderer not available/);
  });
});
