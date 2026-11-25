// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusySendButton } from "./BusySendButton";

afterEach(cleanup);

describe("BusySendButton", () => {
  it("joins the running turn on click", () => {
    const onSend = vi.fn();
    render(<BusySendButton onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSend).toHaveBeenCalledWith("now");
  });

  it("offers sending after the turn on right-click", () => {
    const onSend = vi.fn();
    render(<BusySendButton onSend={onSend} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Send message" }));
    fireEvent.click(screen.getByText("Send after this turn"));
    expect(onSend).toHaveBeenCalledWith("after_turn");
  });
});
