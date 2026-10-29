// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onHost, setViewingSession } from "./ipc";
import { initViewingHint, setComposerRunner } from "./viewingHint";

const route = vi.hoisted(() => ({ sessionId: null as string | null }));
const hosts = vi.hoisted(() => ({ s1: "local", s2: "local", r1: "mac-mini" }));

vi.mock("./ipc", () => ({
  setViewingSession: vi.fn(async () => {}),
  onHost: vi.fn((_host: string, call: () => unknown) => call()),
}));
vi.mock("./router", () => ({ getCurrentRoute: () => route }));
vi.mock("../stores/sessionStore", () => ({
  sessionHostId: (id: keyof typeof hosts) => hosts[id],
}));

function navigate(sessionId: string | null): void {
  route.sessionId = sessionId;
  window.dispatchEvent(new Event("router:historychange"));
}

describe("viewing hint", () => {
  let stop: () => void;

  beforeEach(() => {
    route.sessionId = "s1";
    stop = initViewingHint();
  });

  afterEach(() => {
    navigate(null);
    stop();
    vi.mocked(setViewingSession).mockClear();
    vi.mocked(onHost).mockClear();
  });

  it("tells the host what the window shows, once per change", () => {
    navigate("s2");
    navigate("s2");

    const calls = vi.mocked(setViewingSession).mock.calls;
    expect(calls.map(([id]) => id)).toEqual(["s1", "s2"]);
    expect(calls[0]![1]).toBe(calls[1]![1]);
  });

  it("clears the hint on the machine it leaves", () => {
    navigate("r1");

    expect(onHost).toHaveBeenLastCalledWith("local", expect.any(Function));

    navigate("s1");

    expect(onHost).toHaveBeenCalledWith("mac-mini", expect.any(Function));
    expect(setViewingSession).toHaveBeenCalledWith(null, expect.any(String));
  });

  it("carries the start composer's runner pick", () => {
    setComposerRunner("s1", "custom:apex");

    expect(setViewingSession).toHaveBeenLastCalledWith(
      "s1",
      expect.any(String),
      "custom:apex",
    );
  });

  it("clears the hint when the window goes away", () => {
    window.dispatchEvent(new Event("beforeunload"));

    expect(setViewingSession).toHaveBeenLastCalledWith(
      null,
      expect.any(String),
    );
  });
});
