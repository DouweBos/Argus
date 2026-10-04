import { afterEach, describe, expect, it } from "vitest";
import { appState } from "../../state";
import { type DaemonStatus, WebBrowserPool } from "./pool";

function reserve(key: string): void {
  appState.webBrowserReservations.set(key, {
    agentId: key,
    deviceId: "web:chromium:dead",
    cdpPort: 9333,
    cdpTargetId: "T1",
    driverPort: 7001,
  });
}

function status(patch: Partial<DaemonStatus> = {}): DaemonStatus {
  return {
    ok: true,
    platform: "web",
    driverPort: 7002,
    chromiumCdpPort: 9444,
    pageTargetId: "T2",
    driverStartError: null,
    ...patch,
  };
}

describe("webBrowserPool.liveReservation", () => {
  afterEach(() => {
    appState.webBrowserReservations.clear();
  });

  it("drops the reservation once its daemon is gone", async () => {
    reserve("s1");
    const pool = new WebBrowserPool(async () => null);

    await expect(pool.liveReservation("s1")).resolves.toBeNull();
    expect(pool.getReservation("s1")).toBeNull();
  });

  it("records the port of a browser the daemon relaunched", async () => {
    reserve("s1");
    const pool = new WebBrowserPool(async () => status());

    await expect(pool.liveReservation("s1")).resolves.toMatchObject({
      cdpPort: 9444,
      cdpTargetId: "T2",
      driverPort: 7002,
    });
  });

  it("drops a daemon whose browser never came back", async () => {
    reserve("s1");
    const pool = new WebBrowserPool(async () =>
      status({ chromiumCdpPort: null }),
    );

    await expect(pool.liveReservation("s1")).resolves.toBeNull();
    expect(appState.webBrowserReservations.has("s1")).toBe(false);
  });
});
