import { describe, expect, it } from "vitest";
import { HOST_ONLY_COMMANDS } from "@argus/remote-protocol";
import { commandTarget } from "./routing";

describe("commandTarget", () => {
  it("sends ordinary commands to the host", () => {
    expect(commandTarget("start_agent")).toBe("host");
    expect(commandTarget("list_sessions")).toBe("host");
    expect(commandTarget("list_host_directory")).toBe("host");
  });

  it("opens external links in the client's browser, not the host's", () => {
    // An OAuth link has to land in the browser in front of the human.
    expect(commandTarget("open_external_url")).toBe("client");
  });

  it("keeps this Mac's trust store and updater local", () => {
    expect(commandTarget("remote_start_pairing")).toBe("client");
    expect(commandTarget("remote_list_devices")).toBe("client");
    expect(commandTarget("updater_check")).toBe("client");
    expect(commandTarget("telemetry_capture")).toBe("client");
  });

  it("refuses filesystem commands that would open the wrong Mac", () => {
    expect(commandTarget("reveal_in_finder")).toBe("unavailable");
    expect(commandTarget("open_in_editor")).toBe("unavailable");
    expect(commandTarget("open_path")).toBe("unavailable");
  });

  it("never routes a host-only command to the host", () => {
    for (const command of HOST_ONLY_COMMANDS) {
      expect(commandTarget(command)).not.toBe("host");
    }
  });
});
