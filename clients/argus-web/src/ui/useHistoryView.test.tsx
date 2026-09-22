// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { paneFor, useHistoryView } from "./useHistoryView";

const AGENT = {
  name: "agent" as const,
  agentId: "a1",
  agentLabel: "Fix login",
};
const PROJECT = {
  name: "project" as const,
  repoRoot: "/r",
  projectName: "Aurora",
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("pane assignment", () => {
  it("keeps the project list and a project in the master pane", () => {
    expect(paneFor({ name: "projects" })).toBe("master");
    expect(paneFor(PROJECT)).toBe("master");
  });

  it("puts everything you open out of a project in the detail pane", () => {
    expect(paneFor(AGENT)).toBe("detail");
    expect(paneFor({ name: "devices" })).toBe("detail");
    expect(paneFor({ name: "settings" })).toBe("detail");
  });
});

describe("the two-pane stack", () => {
  it("starts with the project list and nothing in detail", () => {
    const { result } = renderHook(() => useHistoryView());

    expect(result.current.masterView.name).toBe("projects");
    expect(result.current.detailView).toBeNull();
    expect(result.current.canGoBack).toBe(false);
  });

  it("leaves the project on screen when an agent is opened", () => {
    const { result } = renderHook(() => useHistoryView());

    act(() => result.current.push(PROJECT));
    act(() => result.current.push(AGENT));

    expect(result.current.masterView).toMatchObject(PROJECT);
    expect(result.current.detailView).toMatchObject(AGENT);
    // Narrow layouts still read the top of the stack.
    expect(result.current.view).toMatchObject(AGENT);
  });

  it("swaps the detail pane without disturbing the master pane", () => {
    const { result } = renderHook(() => useHistoryView());

    act(() => result.current.push(PROJECT));
    act(() => result.current.push(AGENT));
    act(() => result.current.push({ name: "settings" }));

    expect(result.current.masterView).toMatchObject(PROJECT);
    expect(result.current.detailView?.name).toBe("settings");
  });

  it("falls back to the deepest master view still on the stack", () => {
    const { result } = renderHook(() => useHistoryView());

    act(() => result.current.push(AGENT));

    expect(result.current.masterView.name).toBe("projects");
    expect(result.current.detailView).toMatchObject(AGENT);
  });
});
