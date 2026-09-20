// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HuddleGate } from "./HuddleGate";

function gate(props: Partial<Parameters<typeof HuddleGate>[0]> = {}) {
  return render(
    <HuddleGate state="pending" asked onJoin={vi.fn()} {...props}>
      <div>the huddle</div>
    </HuddleGate>,
  );
}

describe("the huddle gate", () => {
  it("asks for a name before it asks the host for anything", () => {
    const onJoin = vi.fn();
    gate({ state: "connecting", asked: false, onJoin });

    expect(screen.getByPlaceholderText("Your name")).toBeTruthy();
    expect(screen.queryByText("the huddle")).toBeNull();
  });

  it("says plainly that a pending guest is waiting, and shows nothing else", () => {
    gate({ state: "pending" });

    expect(screen.getByText(/Waiting for the host to let you in/)).toBeTruthy();
    // Nothing to navigate to: a pending guest holds no grants at all.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText("the huddle")).toBeNull();
  });

  it("treats a refusal as final", () => {
    gate({ state: "denied" });

    expect(screen.getByText("Not let in")).toBeTruthy();
    expect(screen.queryByText("the huddle")).toBeNull();
  });

  it("offers a way back in after the guest leaves on purpose", () => {
    const onJoin = vi.fn();
    gate({ state: "left", defaultLabel: "Sam", onJoin });

    expect(screen.getByText("You left the huddle")).toBeTruthy();
    screen.getByRole("button", { name: "Ask to rejoin" }).click();
    expect(onJoin).toHaveBeenCalledWith("Sam");
  });

  it("distinguishes the huddle ending from a dead link", () => {
    gate({ state: "ended" });

    expect(screen.getByText("The huddle ended")).toBeTruthy();

    gate({ state: "unavailable" });

    expect(screen.getByText("This link is no longer live")).toBeTruthy();
  });

  it("hands over to the huddle once approved", () => {
    gate({ state: "approved" });

    expect(screen.getByText("the huddle")).toBeTruthy();
  });
});
