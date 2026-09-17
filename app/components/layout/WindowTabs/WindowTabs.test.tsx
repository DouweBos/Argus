// @vitest-environment jsdom
/**
 * The tab strip as rendered. `tabStore.test.ts` covers the model; this covers
 * what a user can actually click — the pinned tab that cannot be closed, the
 * close button, and a tab whose machine is gone still being there to click.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addHostConnection,
  resetConnections,
} from "../../../stores/connectionStore";
import { addRemoteHost } from "../../../stores/settingsStore";
import {
  getTabState,
  openTab,
  resetTabs,
  LOCAL_TAB_ID,
} from "../../../stores/tabStore";
import { WindowTabs } from "./WindowTabs";

function pair(id: string, label: string) {
  addRemoteHost({
    id,
    label,
    url: `ws://${id}`,
    devPrivB64: "",
    devPubB64: "",
    hostPubB64: "",
    capabilities: ["admin"],
    pairedAt: 0,
  });
}

function renderStrip() {
  return render(
    <MemoryRouter>
      <WindowTabs />
    </MemoryRouter>,
  );
}

const tabs = () => screen.getAllByRole("tab");

describe("windowTabs", () => {
  beforeEach(() => {
    Object.assign(window, {
      argus: {
        invoke: vi.fn().mockResolvedValue(null),
        send: vi.fn(),
        on: vi.fn(),
      },
    });
    resetTabs();
    resetConnections();
    localStorage.clear();
  });

  it("pins the local tab and gives it no way to close", () => {
    renderStrip();

    expect(tabs()).toHaveLength(1);
    expect(screen.getByTitle("This Mac")).toBeTruthy();
    expect(screen.queryAllByLabelText(/^Close /)).toHaveLength(0);
  });

  it("activates the tab that was clicked", () => {
    openTab({ title: "Docs", background: true });
    renderStrip();

    fireEvent.click(screen.getByText("Docs"));

    const { tabs: saved, activeId } = getTabState();
    expect(activeId).toBe(saved[1].id);
    expect(activeId).not.toBe(LOCAL_TAB_ID);
  });

  it("closes the tab whose close button was pressed", () => {
    openTab({ title: "Docs", background: true });
    renderStrip();

    fireEvent.click(screen.getByLabelText("Close Docs"));

    expect(getTabState().tabs.map((t) => t.id)).toEqual([LOCAL_TAB_ID]);
    expect(screen.queryByText("Docs")).toBeNull();
  });

  it("keeps a tab whose host went offline, marked disconnected", () => {
    pair("mini", "Mac mini");
    addHostConnection({
      hostId: "mini",
      label: "Mac mini",
      mode: "remote",
      state: "offline",
      hydrated: false,
      lastError: null,
      attachedAt: 1,
    });
    openTab({ hostId: "mini", title: "fix-login", background: true });
    renderStrip();

    expect(screen.getByText("fix-login")).toBeTruthy();
    expect(screen.getByText("Mac mini")).toBeTruthy();
    expect(
      screen.getByTitle("Mac mini — disconnected — showing the last snapshot"),
    ).toBeTruthy();
  });

  it("renders every tab when there are more than fit", () => {
    for (let i = 0; i < 12; i += 1) {
      openTab({ title: `Tab ${i}`, background: true });
    }
    renderStrip();

    expect(tabs()).toHaveLength(13);
    for (let i = 0; i < 12; i += 1) {
      expect(screen.getByText(`Tab ${i}`)).toBeTruthy();
    }
  });
  it("names the machine on every tab, local included", () => {
    renderStrip();

    // The machine is the point of the strip, so it has to be readable — not
    // just a tooltip, or two same-named sessions on different Macs look alike.
    expect(screen.getAllByText("This Mac").length).toBeGreaterThan(0);
  });
});
