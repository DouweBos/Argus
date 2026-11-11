import type { AgentSession } from "./models";
import { afterEach, describe, expect, it } from "vitest";
import { appState } from "../../state";
import { attachedUdids, resolveDeviceRefs } from "./agentDevices";

const lister = {
  ios: async () => [
    { udid: "UDID-PHONE", name: "iPhone 17" },
    { udid: "UDID-PAD", name: "iPad Pro" },
  ],
  android: async () => [{ serial: "emulator-5554", name: "Pixel 9" }],
};

function clear(): void {
  appState.agents.clear();
  appState.simulatorReservations.clear();
}

function liveAgentHolding(id: string): void {
  appState.agents.set("other", {
    agentId: "other",
    status: "idle",
    profile: { devices: [{ platform: "ios", id, name: "x" }] },
  } as AgentSession);
}

describe("resolveDeviceRefs", () => {
  afterEach(clear);

  it("resolves UDIDs, names and serials, once each", async () => {
    await expect(
      resolveDeviceRefs(
        ["iPhone 17", "UDID-PAD", "emulator-5554", "UDID-PHONE"],
        lister,
      ),
    ).resolves.toEqual([
      { platform: "ios", id: "UDID-PHONE", name: "iPhone 17" },
      { platform: "ios", id: "UDID-PAD", name: "iPad Pro" },
      { platform: "android", id: "emulator-5554", name: "Pixel 9" },
    ]);
  });

  it("refuses an unknown device", async () => {
    await expect(resolveDeviceRefs(["nope"], lister)).rejects.toMatch(
      /Unknown device "nope"/,
    );
  });

  it("refuses a device another agent holds", async () => {
    appState.simulatorReservations.set("pooled", {
      agentId: "pooled",
      udid: "UDID-PAD",
      deviceName: "iPad Pro",
      repoRoot: "/r",
    });
    await expect(resolveDeviceRefs(["UDID-PAD"], lister)).rejects.toMatch(
      /held by agent pooled/,
    );
    liveAgentHolding("UDID-PHONE");
    await expect(resolveDeviceRefs(["iPhone 17"], lister)).rejects.toMatch(
      /held by agent other/,
    );
  });
});

describe("attachedUdids", () => {
  afterEach(clear);

  it("covers live agents only", () => {
    liveAgentHolding("UDID-PHONE");
    expect([...attachedUdids()]).toEqual(["UDID-PHONE"]);
    appState.agents.get("other")!.status = "stopped";
    expect(attachedUdids().size).toBe(0);
  });
});
