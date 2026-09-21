/**
 * Sharing an agent bundles whatever the host has open — no toggle — so this
 * resolves the claim key rather than offering a choice.
 */

import { describe, expect, it } from "vitest";
import { shareableDeviceKey } from "./huddleDevice";

const none = { androidSerial: null, iosUdid: null };

describe("shareableDeviceKey", () => {
  it("shares the selected simulator", () => {
    expect(
      shareableDeviceKey(
        { ...none, iosUdid: "UDID-1", platform: "ios" },
        "ws-1",
      ),
    ).toBe("UDID-1");
  });

  it("shares the selected Android device", () => {
    expect(
      shareableDeviceKey(
        { ...none, androidSerial: "emulator-5554", platform: "android" },
        "ws-1",
      ),
    ).toBe("emulator-5554");
  });

  it("namespaces the embedded browser by session", () => {
    expect(shareableDeviceKey({ ...none, platform: "web" }, "ws-1")).toBe(
      "browser:ws-1",
    );
  });

  it("shares nothing when no device is picked — the room is chat-only", () => {
    expect(shareableDeviceKey({ ...none, platform: "ios" }, "ws-1")).toBe("");
  });

  it("never shares a capture card on this desk", () => {
    expect(shareableDeviceKey({ ...none, platform: "video" }, "ws-1")).toBe("");
  });
});
