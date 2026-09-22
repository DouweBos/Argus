// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { PickerPopover } from "./PickerPopover";

function Harness({ onClose }: { onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div ref={ref}>
      <button type="button">Model</button>
      <PickerPopover triggerRef={ref} onClose={onClose ?? (() => {})}>
        <PickerPopover.Header>Switch model</PickerPopover.Header>
        <PickerPopover.Option name="Opus 5" selected onSelect={() => {}} />
      </PickerPopover>
    </div>
  );
}

describe("the picker popover", () => {
  it("still shows up when it mounts already open", async () => {
    // The anchor's ref is not attached yet when a child's layout effect runs,
    // so the popover has to retry rather than render nothing forever.
    render(<Harness />);

    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(screen.getByRole("option").getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("closes on a pointer press outside, but not inside", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await waitFor(() => screen.getByRole("listbox"));

    fireEvent.pointerDown(screen.getByRole("option"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await waitFor(() => screen.getByRole("listbox"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
