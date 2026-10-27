/**
 * Resolves a device id to the {@link DeviceSource} that owns it. Providers own
 * id namespaces; the machine provider (this Mac + SSH device hosts) is the
 * fallback, so a new prefix registers in front of it without touching callers.
 */

import type {
  DeviceCapability,
  DeviceCaps,
  DeviceSource,
  DeviceSourceProvider,
} from "./deviceSource";
import { NO_CAPS } from "./deviceSource";
import { machineDeviceProvider } from "./machineSource";

const providers: DeviceSourceProvider[] = [];
const goneListeners = new Set<(sourceId: string) => void>();
const unsubscribes = new Map<DeviceSourceProvider, () => void>();

/** Add a provider ahead of those already registered. Returns an unregister. */
export function registerDeviceSourceProvider(
  provider: DeviceSourceProvider,
): () => void {
  providers.unshift(provider);
  unsubscribes.set(
    provider,
    provider.onGone((sourceId) => {
      for (const listener of goneListeners) {
        listener(sourceId);
      }
    }),
  );

  return () => {
    const at = providers.indexOf(provider);
    if (at >= 0) {
      providers.splice(at, 1);
    }
    unsubscribes.get(provider)?.();
    unsubscribes.delete(provider);
  };
}

registerDeviceSourceProvider(machineDeviceProvider);

function owner(
  deviceId: string,
): { provider: DeviceSourceProvider; sourceId: string } | null {
  for (const provider of providers) {
    const sourceId = provider.sourceIdOf(deviceId);
    if (sourceId !== null) {
      return { provider, sourceId };
    }
  }

  return null;
}

/** Which source a device id belongs to, without needing that source alive. */
export function deviceSourceIdOf(deviceId: string): string | null {
  return owner(deviceId)?.sourceId ?? null;
}

/** The source behind a device id; throws when it's gone. */
export function resolveDeviceSource(deviceId: string): DeviceSource {
  const found = owner(deviceId);
  if (!found) {
    throw `No device source for ${deviceId}.`;
  }

  return found.provider.resolve(found.sourceId);
}

/** Every source other than this Mac worth listing right now. */
export function listableDeviceSources(): DeviceSource[] {
  return providers.flatMap((p) => p.listable());
}

/** What a device supports; nothing when its source is gone. */
export function deviceCapabilities(deviceId: string): DeviceCaps {
  try {
    const source = resolveDeviceSource(deviceId);

    return source.capabilities(deviceId);
  } catch {
    return NO_CAPS;
  }
}

/** Throw the source's own reason when a device lacks `capability`. */
export function requireCapability(
  deviceId: string,
  capability: DeviceCapability,
): void {
  const source = resolveDeviceSource(deviceId);
  if (!source.capabilities(deviceId)[capability]) {
    throw source.unsupported(capability);
  }
}

/** Called with a source's id when it goes away for good. */
export function onDeviceSourceGone(
  listener: (sourceId: string) => void,
): () => void {
  goneListeners.add(listener);

  return () => goneListeners.delete(listener);
}
