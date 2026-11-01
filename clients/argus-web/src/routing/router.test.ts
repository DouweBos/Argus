// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appNavigate,
  currentLocation,
  navigateBack,
  stripQuery,
  subscribeLocation,
} from "./router";
import { HOME } from "./screens";

const AGENT = { name: "agent", sessionId: "s1", agentId: "a1" } as const;

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the web router", () => {
  it("puts each screen at its own path", () => {
    appNavigate(AGENT);

    expect(window.location.pathname).toBe("/sessions/s1/agents/a1");
    expect(currentLocation().screen).toEqual(AGENT);
  });

  it("pushes one entry per navigation, and none for the screen already open", () => {
    const before = window.history.length;
    appNavigate(AGENT);
    appNavigate(AGENT);

    expect(window.history.length).toBe(before + 1);
  });

  it("keeps the computer across navigations until one names another", () => {
    window.history.replaceState(null, "", "/?host=h1");
    appNavigate({ name: "devices" });
    expect(window.location.search).toBe("?host=h1");

    appNavigate(HOME, { hostId: null });
    expect(currentLocation().hostId).toBeNull();
  });

  it("leaves the fragment alone", () => {
    window.history.replaceState(null, "", "/#/huddle/tok");
    appNavigate({ name: "settings" });

    expect(window.location.hash).toBe("#/huddle/tok");
  });

  it("goes to the parent when Back would leave a deep-linked tab", () => {
    window.history.replaceState(null, "", "/sessions/s1/agents/a1");
    const back = vi.spyOn(window.history, "back");
    navigateBack({ name: "projects" });

    expect(back).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
  });

  it("uses browser history once the tab has navigated", () => {
    appNavigate(AGENT);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    navigateBack();

    expect(back).toHaveBeenCalledOnce();
    back.mockRestore();
  });

  it("strips launch parameters and tells listeners", () => {
    window.history.replaceState(null, "", "/?agent=a1&decide=allow&host=h1");
    const listener = vi.fn();
    const stop = subscribeLocation(listener);
    stripQuery("agent", "decide");
    stop();

    expect(window.location.search).toBe("?host=h1");
    expect(listener).toHaveBeenCalled();
  });
});
