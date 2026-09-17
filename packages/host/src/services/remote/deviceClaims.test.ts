import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addHostEventSink, resetHostEventSinks } from "@argus/host/bus";
import {
  CLAIM_IDLE_MS,
  claimDevice,
  claimState,
  getClaim,
  releaseDevice,
  resetClaims,
} from "./deviceClaims";

const holderA = {
  connectionId: "conn-a",
  deviceId: "dev-a",
  label: "Laptop",
};
const holderB = {
  connectionId: "conn-b",
  deviceId: "dev-b",
  label: "Mac mini",
};

describe("deviceClaims", () => {
  let published: { device_id: string; holder: unknown }[];

  beforeEach(() => {
    vi.useFakeTimers();
    resetClaims();
    resetHostEventSinks();
    published = [];
    addHostEventSink((channel, args) => {
      if (channel === "devices:claim-changed") {
        published.push(args[0] as { device_id: string; holder: unknown });
      }
    });
  });

  afterEach(() => {
    resetClaims();
    resetHostEventSinks();
    vi.useRealTimers();
  });

  it("announces the idle lapse instead of leaving clients stuck", () => {
    claimDevice("sim-1", holderA);
    expect(published).toHaveLength(1);

    vi.advanceTimersByTime(CLAIM_IDLE_MS + 100);

    expect(published.at(-1)).toEqual({ device_id: "sim-1", holder: null });
    expect(getClaim("sim-1")).toBeNull();
  });

  it("takes the next client's claim without a force once it has lapsed", () => {
    claimDevice("sim-1", holderA);
    vi.advanceTimersByTime(CLAIM_IDLE_MS + 100);

    expect(claimDevice("sim-1", holderB).granted).toBe(true);
    expect(getClaim("sim-1")?.label).toBe("Mac mini");
  });

  it("keeps the lapse alive while the holder is still driving", () => {
    claimDevice("sim-1", holderA);
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(CLAIM_IDLE_MS / 2);
      claimDevice("sim-1", holderA);
    }

    expect(getClaim("sim-1")?.label).toBe("Laptop");
    // Only the initial acquisition was announced — a refresh changes nothing.
    expect(published).toHaveLength(1);
  });

  it("cancels the lapse announcement once released explicitly", () => {
    claimDevice("sim-1", holderA);
    releaseDevice("sim-1", holderA.connectionId);
    published = [];

    vi.advanceTimersByTime(CLAIM_IDLE_MS * 2);

    expect(published).toEqual([]);
  });

  it("keeps two devices' claims apart", () => {
    claimDevice("sim-1", holderA);
    claimDevice("browser:sess-1", holderB);

    expect(claimState("sim-1").holder?.label).toBe("Laptop");
    expect(claimState("browser:sess-1").holder?.label).toBe("Mac mini");
  });
});
