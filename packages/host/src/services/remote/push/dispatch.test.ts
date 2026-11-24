import type { AccountPushTarget } from "../../account/push";
import type { PairedDevice } from "../deviceStore";
import { describe, expect, it, vi } from "vitest";

vi.mock("../gateway", () => ({ getConnectedDeviceIds: () => [] }));

const { pushTargets } = await import("./dispatch");

function device(
  id: string,
  notifications?: PairedDevice["notifications"],
): PairedDevice {
  return {
    device_id: id,
    label: id,
    dev_static_pub: "",
    capabilities: [],
    created_at: 0,
    last_seen: null,
    push: { service: "apns", token: id, push_key: `key-${id}`, updated_at: 0 },
    notifications,
  };
}

const account = (id: string): AccountPushTarget => ({
  device_id: id,
  label: id,
  service: "apns",
  environment: "production",
  push_key: `account-${id}`,
});

describe("pushTargets", () => {
  const phone = device("phone", { needs_you: true, finished: false });
  const tablet = device("tablet");
  const ids = (r: ReturnType<typeof pushTargets>) => ({
    targets: r.targets.map((d) => d.device_id),
    viaAccount: r.viaAccount.map((t) => t.device_id),
  });

  it("never pushes a category a device turned off", () => {
    expect(
      ids(pushTargets("finished", [phone, tablet], [], new Set())),
    ).toEqual({ targets: ["tablet"], viaAccount: [] });
    expect(
      ids(pushTargets("permission", [phone, tablet], [], new Set())),
    ).toEqual({ targets: ["phone", "tablet"], viaAccount: [] });
  });

  it("counts failures and nudges as needing you", () => {
    const quiet = device("quiet", { needs_you: false, finished: true });
    for (const kind of ["failed", "push", "permission"] as const) {
      expect(pushTargets(kind, [quiet], [], new Set()).targets).toEqual([]);
    }
    expect(pushTargets("finished", [quiet], [], new Set()).targets).toEqual([
      quiet,
    ]);
  });

  it("applies an account device's choice from its record here", () => {
    const record = { ...phone, push: null };
    expect(
      ids(
        pushTargets(
          "finished",
          [record],
          [account("phone"), account("laptop")],
          new Set(),
        ),
      ),
    ).toEqual({ targets: [], viaAccount: ["laptop"] });
  });

  it("skips connected devices, which hear it in-band", () => {
    expect(
      pushTargets("permission", [tablet], [], new Set(["tablet"])).targets,
    ).toEqual([]);
  });
});
