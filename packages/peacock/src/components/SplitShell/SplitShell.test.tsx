// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplitShell } from "./SplitShell";

function pointer(type: string, init: Record<string, unknown>) {
  return Object.assign(new Event(type, { bubbles: true }), init);
}

function drag(from: number, to: number) {
  const divider = screen.getByRole("separator");
  fireEvent.pointerDown(divider, { pointerId: 1, clientX: from, clientY: 10 });
  fireEvent(window, pointer("pointermove", { pointerId: 1, clientX: to }));
  fireEvent(window, pointer("pointerup", { pointerId: 1 }));

  return divider.parentElement as HTMLElement;
}

describe("the split shell sidebar", () => {
  it("follows a pointer drag, so a finger resizes it too", () => {
    render(
      <SplitShell sidebar={<div>side</div>}>
        <div>main</div>
      </SplitShell>,
    );

    expect(drag(300, 400).style.width).toBe("400px");
  });

  it("will not drag past its bounds", () => {
    render(
      <SplitShell maxSidebarWidth={360} minSidebarWidth={260} sidebar={null}>
        <div>main</div>
      </SplitShell>,
    );

    expect(drag(300, 900).style.width).toBe("360px");
    expect(drag(360, 0).style.width).toBe("260px");
  });

  it("drops the divider when collapsed — there is nothing to resize", () => {
    render(
      <SplitShell collapsed sidebar={<div>side</div>}>
        <div>main</div>
      </SplitShell>,
    );

    expect(screen.queryByRole("separator")).toBeNull();
  });
});
