/** Listing and booting iOS simulators across every device source. */

import type { DeviceSource, SimulatorDevice } from "./deviceSource";
import { warn } from "@argus/host/logger";
import { localMachine } from "../deviceHosts/machine";
import {
  listableDeviceSources,
  onDeviceSourceGone,
  resolveDeviceSource,
} from "./deviceSources";
import { localDeviceSource } from "./machineSource";

/**
 * Check whether Xcode Command Line Tools (xcrun + simctl) are available.
 *
 * Resolves on success, throws a user-facing message on failure.
 */
export async function checkIosTools(): Promise<void> {
  try {
    await localMachine.exec("xcrun", ["simctl", "help"]);
  } catch {
    throw "Xcode Command Line Tools not found. Install them by running: xcode-select --install";
  }
}

/**
 * List this Mac's iOS simulator devices. Agents' pool and conductor only drive
 * local devices, so this stays local; pickers use {@link listAllSimulators}.
 * Booted first, then alphabetical by name.
 */
export function listSimulators(): Promise<SimulatorDevice[]> {
  return localDeviceSource.list();
}

/** How long a list waits on another source before using its last answer. */
const REMOTE_LIST_WAIT_MS = 1_500;

/** Each source's last listing, plus the refresh in flight, so a slow or
 *  offline one never holds up this Mac's devices. */
const listings = new Map<
  string,
  { devices: SimulatorDevice[]; inflight?: Promise<void> }
>();

function listCached(source: DeviceSource): Promise<SimulatorDevice[]> {
  let entry = listings.get(source.id);
  if (!entry) {
    entry = { devices: [] };
    listings.set(source.id, entry);
  }
  const listing = entry;
  listing.inflight ??= source
    .list()
    .then((devices) => {
      listing.devices = devices;
    })
    .catch((e: unknown) => {
      warn(`[Simulator] listing ${source.id} failed:`, e);
      listing.devices = [];
    })
    .finally(() => {
      listing.inflight = undefined;
    });
  const answered = listing.inflight;

  return Promise.race([
    answered,
    new Promise<void>((resolve) => {
      setTimeout(resolve, REMOTE_LIST_WAIT_MS).unref?.();
    }),
  ]).then(() => listing.devices);
}

/**
 * This Mac's simulators plus every other reachable source's, namespaced and
 * labelled. An unreachable source contributes nothing rather than failing the list.
 */
export async function listAllSimulators(): Promise<SimulatorDevice[]> {
  const sources = listableDeviceSources();
  const [local, ...others] = await Promise.all([
    // No Xcode here shouldn't hide another source's simulators.
    sources.length > 0 ? listSimulators().catch(() => []) : listSimulators(),
    ...sources.map(listCached),
  ]);

  return [...local, ...others.flat()];
}

onDeviceSourceGone((sourceId) => {
  listings.delete(sourceId);
});

/**
 * Return the UDID of the first booted simulator, or null if none are booted.
 */
export async function activeSimulator(): Promise<string | null> {
  const devices = await listSimulators();

  return devices.find((d) => d.booted)?.udid ?? null;
}

/** Boot a simulator and wait until it is usable; already booted is fine. */
export async function bootSimulator(udid: string): Promise<void> {
  await resolveDeviceSource(udid).open(udid);
}
