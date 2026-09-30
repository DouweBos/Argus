/**
 * The whole command surface, as the desktop registers it: the host core's
 * commands plus the shell's. Asserted empirically from the registry rather
 * than by reading source, so a rename can never silently open a hole.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  type CommandSpec,
  COMMANDS,
  HOST_ONLY_COMMANDS,
} from "@argus/remote-protocol";

vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0", quit: vi.fn() },
  clipboard: {},
  dialog: {},
  ipcMain: { handle: vi.fn() },
  Menu: {},
  nativeImage: {},
  safeStorage: { isEncryptionAvailable: () => false },
  systemPreferences: {},
}));
vi.mock("./popouts", () => ({ agentPopouts: new Map() }));
vi.mock("./services/continuity", () => ({ publishActivity: vi.fn() }));
vi.mock("./services/updater", () => ({}));

const { getCommandTier, listCommands, resetCommandRegistry } =
  await import("@argus/host/services/command/registry");
const { registerHostCommands } = await import("@argus/host/commands/index");
const { registerShellCommands } = await import("./shellCommands");

const tiers = new Map<string, string>();

describe("the desktop command surface", () => {
  beforeAll(() => {
    resetCommandRegistry();
    // Registration throws on a duplicate name, so this alone proves every
    // command is registered exactly once across the two halves.
    registerHostCommands();
    registerShellCommands({
      createFloatingDeviceWindow: vi.fn(),
      closeFloatingDeviceWindow: vi.fn(),
      createFloatingAgentWindow: vi.fn(),
      closeFloatingAgentWindow: vi.fn(),
      markQuitConfirmedDespiteAgents: vi.fn(),
    });
    for (const { name, tier } of listCommands()) {
      tiers.set(name, tier);
    }
  });

  it("registers a non-trivial number of commands", () => {
    expect(tiers.size).toBeGreaterThan(300);
  });

  it("registers every catalog command at its catalog tier", () => {
    const catalog: Record<string, CommandSpec> = COMMANDS;
    const wrong = Object.entries(catalog)
      .filter(([name, spec]) => tiers.get(name) !== spec.tier)
      .map(([name]) => name);
    expect(wrong).toEqual([]);
  });

  it("puts exactly the host-only commands at the host tier", () => {
    const hostTier = [...tiers]
      .filter(([, tier]) => tier === "host")
      .map(([name]) => name)
      .sort();
    expect(hostTier).toEqual([...HOST_ONLY_COMMANDS].sort());
  });

  it("keeps updater_get_state remotable", () => {
    expect(HOST_ONLY_COMMANDS.has("updater_get_state")).toBe(false);
    expect(getCommandTier("updater_get_state")).toBe("admin");
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

  it("registers exactly the catalog, every command typed", () => {
    expect([...tiers.keys()].sort()).toEqual(Object.keys(COMMANDS).sort());
  });
});
