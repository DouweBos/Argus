/**
 * Devices on a Mac Argus can run commands on — this one, or a device host over
 * SSH. Everything goes through the machine's `simctl` and the bundled bridge,
 * so the same code serves both; only what conductor can reach differs.
 */

import type {
  DeviceCapability,
  DeviceCaps,
  DeviceSource,
  DeviceSourceProvider,
  SimulatorDevice,
} from "./deviceSource";
import { execFile } from "node:child_process";
import { warn } from "@argus/host/logger";
import { parseDeviceId, remoteDeviceId } from "../deviceHosts/deviceId";
import { type DeviceMachine, localMachine } from "../deviceHosts/machine";
import {
  deviceHostMachine,
  onDeviceHostRemoved,
  reachableDeviceHosts,
} from "../deviceHosts/registry";
import { capture } from "../telemetry/telemetry";
import { LOCAL_SOURCE_ID } from "./deviceSource";
import { MachineSession } from "./machineSession";
import { listSimulatorsOn } from "./simctl";
import { describeSimctlFailure } from "./simctlProblems";

/** How long one device host gets to answer before the list goes without it. */
const REMOTE_LIST_TIMEOUT_MS = 15_000;

/** How long to wait for a freshly booted simulator to finish coming up. */
const BOOT_WAIT_MS = 120_000;

const LOCAL_CAPS: DeviceCaps = {
  rotation: true,
  fold: true,
  conductor: true,
  settings: true,
  erase: true,
  delete: true,
  adaptiveVideo: true,
};

/** conductor, which drives pose and settings, only sees this Mac. */
const HOST_CAPS: DeviceCaps = {
  ...LOCAL_CAPS,
  rotation: false,
  fold: false,
  conductor: false,
  settings: false,
};

const POSE_UNSUPPORTED =
  "Rotating and folding aren't available for simulators on a device host yet.";
const CONDUCTOR_UNSUPPORTED =
  "conductor only reaches this Mac's devices, not a device host's.";

export class MachineDeviceSource implements DeviceSource {
  readonly id: string;
  private readonly remote: boolean;

  constructor(
    private readonly machine: DeviceMachine,
    private readonly label?: string,
  ) {
    this.id = machine.hostId ?? LOCAL_SOURCE_ID;
    this.remote = machine.hostId !== null;
  }

  /** The UDID as this machine knows it. */
  private udid(id: string): string {
    return parseDeviceId(id).udid;
  }

  private named(device: SimulatorDevice): SimulatorDevice {
    const hostId = this.machine.hostId;
    if (hostId === null) {
      return device;
    }

    return {
      ...device,
      udid: remoteDeviceId(hostId, device.udid),
      deviceHostId: hostId,
      deviceHostLabel: this.label,
    };
  }

  async list(): Promise<SimulatorDevice[]> {
    const devices = await listSimulatorsOn(
      this.machine,
      this.remote ? REMOTE_LIST_TIMEOUT_MS : undefined,
    );

    return devices.map((d) => this.named(d));
  }

  async find(id: string): Promise<SimulatorDevice | undefined> {
    const udid = this.udid(id);
    const devices = await listSimulatorsOn(
      this.machine,
      REMOTE_LIST_TIMEOUT_MS,
    );
    const found = devices.find((d) => d.udid === udid);

    return found && this.named(found);
  }

  /**
   * Boot and wait until it's usable. "Already booted" is not treated as an
   * error, mirroring the Rust implementation's tolerance for simctl's "Booted".
   */
  async open(id: string): Promise<void> {
    try {
      await this.machine.exec("xcrun", ["simctl", "boot", this.udid(id)]);
    } catch (e) {
      const msg = String(e);
      // simctl exits non-zero with "Unable to boot device in current state: Booted"
      // when the device is already running — that is not a real error.
      if (!msg.includes("Booted")) {
        warn(`[Simulator] boot failed for ${id}:`, msg);
        const failure = describeSimctlFailure(msg);
        capture("simulator_boot_failed", { reason: failure.reason });
        throw failure.message;
      }
    }

    await this.waitForBoot(id);

    // Bring Simulator.app to the foreground showing this device
    this.show(id);
  }

  /**
   * Block until the device reports a finished boot. `simctl boot` returns as
   * soon as the request is accepted, and capture against a half-booted device
   * only ever sees a nil framebuffer surface.
   */
  private async waitForBoot(id: string): Promise<void> {
    const udid = this.udid(id);
    try {
      await this.machine.exec("xcrun", ["simctl", "bootstatus", udid, "-b"], {
        timeoutMs: BOOT_WAIT_MS,
      });
    } catch (e) {
      // bootstatus is advisory — an older runtime may not support `-b`, and the
      // capture loop retries anyway. Don't fail the boot over it.
      warn(`[Simulator] bootstatus failed for ${udid}:`, e);
    }
  }

  /**
   * Switch Simulator.app to display the given device.
   *
   * Only matters up to Xcode 25 — Xcode 26 dropped Simulator.app for the Device
   * Hub, which has no equivalent CLI, and capture reads CoreSimulator's
   * framebuffer directly either way. Fire-and-forget: failures are ignored.
   */
  show(id: string): void {
    // A device host's Simulator.app is on someone else's screen.
    if (this.remote) {
      return;
    }
    execFile(
      "open",
      ["-g", "-a", "Simulator", "--args", "-CurrentDeviceUDID", id],
      () => {
        // Ignore errors — Simulator.app is gone as of Xcode 26.
      },
    );
  }

  async close(id: string): Promise<void> {
    try {
      await this.machine.exec("xcrun", ["simctl", "shutdown", this.udid(id)]);
    } catch (e) {
      const msg = String(e);
      // Already shut down is not a real error.
      if (!msg.includes("Shutdown") && !msg.includes("current state")) {
        throw `Failed to shutdown simulator: ${msg}`;
      }
    }
  }

  async erase(id: string): Promise<void> {
    await this.machine.exec("xcrun", ["simctl", "erase", this.udid(id)]);
  }

  async delete(id: string): Promise<void> {
    await this.machine.exec("xcrun", ["simctl", "delete", this.udid(id)]);
  }

  session(id: string): MachineSession {
    return new MachineSession(this.machine, id, this.udid(id));
  }

  capabilities(): DeviceCaps {
    return this.remote ? HOST_CAPS : LOCAL_CAPS;
  }

  unsupported(capability: DeviceCapability): string {
    switch (capability) {
      case "rotation":
      case "fold":
        return POSE_UNSUPPORTED;
      case "conductor":
      case "settings":
        return CONDUCTOR_UNSUPPORTED;
      default:
        return `That isn't available for this device (${capability}).`;
    }
  }
}

export const localDeviceSource = new MachineDeviceSource(localMachine);

/** One source per machine, so a host keeps its identity across lookups. */
const sourcesByMachine = new WeakMap<DeviceMachine, MachineDeviceSource>();

function sourceFor(machine: DeviceMachine, label: string): MachineDeviceSource {
  let source = sourcesByMachine.get(machine);
  if (!source) {
    source = new MachineDeviceSource(machine, label);
    sourcesByMachine.set(machine, source);
  }

  return source;
}

/**
 * This Mac plus every saved device host. The fallback provider: any id no
 * other namespace claims is this Mac's.
 */
export const machineDeviceProvider: DeviceSourceProvider = {
  sourceIdOf: (deviceId) => parseDeviceId(deviceId).hostId ?? LOCAL_SOURCE_ID,
  resolve: (sourceId) => {
    if (sourceId === LOCAL_SOURCE_ID) {
      return localDeviceSource;
    }
    const { config, machine } = deviceHostMachine(sourceId);

    return sourceFor(machine, config.label);
  },
  listable: () =>
    reachableDeviceHosts().map(({ config, machine }) =>
      sourceFor(machine, config.label),
    ),
  onGone: (listener) => onDeviceHostRemoved(listener),
};
