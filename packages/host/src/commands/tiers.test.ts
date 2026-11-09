/**
 * The whole command surface's tiers, asserted empirically from the registry
 * rather than by reading source, so a rename can never silently open a hole.
 */

import { HOST_ONLY_COMMANDS } from "@argus/remote-protocol";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getCommandTier,
  listCommands,
  resetCommandRegistry,
} from "../services/command/registry";
import { registerHostCommands } from "./index";

const tiers = new Map<string, string>();

describe("the host command tiers", () => {
  beforeAll(() => {
    resetCommandRegistry();
    registerHostCommands();
    for (const { name, tier } of listCommands()) {
      tiers.set(name, tier);
    }
  });

  it("registers a non-trivial number of commands", () => {
    expect(tiers.size).toBeGreaterThan(300);
  });

  it("puts exactly the host-only commands at the host tier", () => {
    const hostTier = [...tiers]
      .filter(([, tier]) => tier === "host")
      .map(([name]) => name)
      .sort();
    expect(hostTier).toEqual([...HOST_ONLY_COMMANDS].sort());
  });

  /**
   * Grants are decided at the host's console and nowhere else. If any of these
   * became remotable, an admin device could widen its own grant — or pair a new
   * device to the host — which is the one escalation the tier model must not
   * allow.
   */
  it("never lets a client change who is paired or what they may do", () => {
    for (const command of [
      "remote_start_pairing",
      "remote_confirm_pairing",
      "remote_cancel_pairing",
      "remote_set_device_control",
      "remote_revoke_device",
    ]) {
      expect(getCommandTier(command)).toBe("host");
      expect(HOST_ONLY_COMMANDS.has(command)).toBe(true);
    }
  });

  /**
   * Automations are host state. A desktop driving a headless mini must manage
   * the mini's automations, so the whole family is admin-tier and remotable.
   */
  it("keeps the automations family admin-tier and remotable", () => {
    const family = [...tiers.keys()].filter((name) =>
      /^(automation|automations|proposal|proposals|signal_sources)_/.test(name),
    );
    expect(family).toEqual(
      expect.arrayContaining([
        "automations_list",
        "automation_create",
        "automation_run_now",
        "automation_runs_list",
        "automation_calibration",
        "automation_run_scratch",
        "automation_scratch_save",
        "proposals_list",
        "proposal_accept",
        "signal_sources_list",
      ]),
    );
    expect(family.filter((name) => tiers.get(name) !== "admin")).toEqual([]);
    expect(family.filter((name) => HOST_ONLY_COMMANDS.has(name))).toEqual([]);
  });
});
