import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  devTrustAllowed,
  hostModeBehaviour,
  hostModeEnv,
  parseHostMode,
} from "./hostMode";

const HOME = "/Users/someone";

describe("parseHostMode", () => {
  it("reads the mode flag anywhere in argv", () => {
    expect(parseHostMode(["node", "argus-host.js", "--desktop"])).toBe(
      "desktop",
    );
    expect(
      parseHostMode(["node", "argus-host.js", "--ui-socket", "s", "--server"]),
    ).toBe("server");
    expect(parseHostMode(["node", "argus-host.js", "login"])).toBe("cli");
  });
});

describe("hostModeEnv", () => {
  it("leaves the desktop's env alone", () => {
    expect(hostModeEnv("desktop", {}, HOME)).toEqual({});
  });

  it("defaults the server to its own home and the server port", () => {
    expect(hostModeEnv("server", {}, HOME)).toEqual({
      ARGUS_SERVER: "1",
      ARGUS_HOME: path.join(HOME, ".argus-server"),
      ARGUS_REMOTE_PORT: "47617",
    });
  });

  it("defaults the cli to ~/.argus-host", () => {
    expect(hostModeEnv("cli", {}, HOME)).toEqual({
      ARGUS_SERVER: "1",
      ARGUS_HOME: path.join(HOME, ".argus-host"),
      ARGUS_REMOTE_PORT: "47617",
    });
  });

  it("keeps an explicit home and port", () => {
    const env = { ARGUS_HOME: "/tmp/h", ARGUS_REMOTE_PORT: "5000" };
    for (const mode of ["server", "cli"] as const) {
      expect(hostModeEnv(mode, env, HOME)).toMatchObject(env);
    }
  });
});

describe("hostModeBehaviour", () => {
  it("runs the desktop supervised on its own settings", () => {
    expect(hostModeBehaviour("desktop")).toEqual({
      lockOwner: "mac",
      forceRemote: false,
      powerAssertion: false,
      supervised: true,
      drainAgentsOnQuit: true,
      console: false,
      gatewayBanner: false,
    });
  });

  it("runs the server supervised, always reachable and awake", () => {
    expect(hostModeBehaviour("server")).toEqual({
      lockOwner: "mac-server",
      forceRemote: true,
      powerAssertion: true,
      supervised: true,
      drainAgentsOnQuit: true,
      console: false,
      gatewayBanner: true,
    });
  });

  it("runs the cli unsupervised with its console", () => {
    expect(hostModeBehaviour("cli")).toEqual({
      lockOwner: "cli",
      forceRemote: true,
      powerAssertion: true,
      supervised: false,
      drainAgentsOnQuit: false,
      console: true,
      gatewayBanner: true,
    });
  });
});

describe("devTrustAllowed", () => {
  it("needs ARGUS_DEV_TRUST=1", () => {
    expect(devTrustAllowed({}, HOME)).toBe(false);
    expect(devTrustAllowed({ ARGUS_DEV_TRUST: "true" }, HOME)).toBe(false);
  });

  it("allows a checkout and a Debug build", () => {
    expect(devTrustAllowed({ ARGUS_DEV_TRUST: "1" }, HOME)).toBe(true);
    expect(
      devTrustAllowed(
        {
          ARGUS_DEV_TRUST: "1",
          ARGUS_RESOURCES: `${HOME}/Library/Developer/Xcode/DerivedData/x/Build/Products/Debug/Argus Server.app/Contents/Resources/host`,
        },
        HOME,
      ),
    ).toBe(true);
  });

  it("refuses an installed app", () => {
    for (const resources of [
      "/Applications/Argus Server.app/Contents/Resources/host",
      `${HOME}/Applications/Argus Server.app/Contents/Resources/host`,
      "/Applications/../Applications/Argus Server.app/Contents/Resources",
    ]) {
      expect(
        devTrustAllowed(
          { ARGUS_DEV_TRUST: "1", ARGUS_RESOURCES: resources },
          HOME,
        ),
      ).toBe(false);
    }
  });
});
