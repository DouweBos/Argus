import { describe, expect, it } from "vitest";
import { deviceHostView } from "./deviceHosts";

describe("deviceHostView", () => {
  it("labels an EAS host by its running sessions", () => {
    const view = deviceHostView({
      id: "eh1",
      label: "Expo",
      status: "connected",
      kind: "eas",
      running_sessions: 1,
      max_sessions: 2,
    });
    expect(view.statusLabel).toBe("EAS · 1 of 2 running");
    expect(view.full).toBe(false);
    expect(view.tone).toBe("success");
  });

  it("is full at its limit", () => {
    const view = deviceHostView({
      id: "eh1",
      label: "Expo",
      status: "unknown",
      kind: "eas",
      running_sessions: 2,
      max_sessions: 2,
    });
    expect(view.full).toBe(true);
  });

  it("treats a host with no kind as SSH", () => {
    const view = deviceHostView({
      id: "rh1",
      label: "Studio",
      status: "unreachable",
    });
    expect(view.kind).toBe("ssh");
    expect(view.statusLabel).toBe("Unreachable");
    expect(view.tone).toBe("warning");
  });
});
