import { describe, expect, it } from "vitest";
import { LOCAL_GATEWAY_PORT } from "../services/remote/remoteService";
import { gatewayLine } from "./hostBanner";

describe("gatewayLine", () => {
  it("prints the address once the gateway is listening", () => {
    expect(gatewayLine(null)).toBe(
      `Gateway: ws://127.0.0.1:${LOCAL_GATEWAY_PORT}`,
    );
  });

  it("prints the failure instead of an address nothing listens on", () => {
    const line = gatewayLine("cannot decrypt remote-devices.json");
    expect(line).toBe(
      "Remote access failed to start: cannot decrypt remote-devices.json",
    );
    expect(line).not.toContain("ws://");
  });
});
