/**
 * The plugin registry. One manifest per first-party plugin Argus ships.
 *
 * Adding a plugin: append a manifest here, add the id to `PluginId` in
 * `types.ts`, and (in chunks 5/6) populate the `contributes` field with the
 * actual UI surfaces.
 *
 * `defaultEnabled`, `bundled`, and `lazy` are temporarily set to preserve
 * current behavior while the plumbing lands. The chunk-12 commit flips them
 * to the end-state values (`defaultEnabled: false`, `bundled: false`,
 * `lazy: true`).
 */

import type { PluginManifest } from "./types";
import { Icons } from "@argus/peacock";

export const PLUGINS: readonly PluginManifest[] = [
  {
    id: "device-recording",
    name: "Device recording",
    description:
      "Stream iOS Simulator and Android emulator screens into Argus's runtime panel.",
    group: "Device",
    defaultEnabled: false,
    prereqs: [
      "native_bridge",
      "xcode",
      "ios_runtimes",
      "android_sdk",
      "android_avd",
    ],
    bundled: false,
    lazy: true,
    contributes: {
      ipcGroup: "device-recording",
      toolRail: [
        {
          id: "simulator",
          label: "Simulator",
          icon: Icons.SimulatorIcon,
          placement: "right",
        },
      ],
    },
  },
  {
    id: "device-inspector",
    name: "Device UI inspector",
    description:
      "Inspect view hierarchy, accessibility, and layout on a connected device.",
    group: "Device",
    defaultEnabled: false,
    requires: ["device-recording"],
    bundled: false,
    lazy: true,
    contributes: {
      ipcGroup: "device-inspector",
    },
  },
  {
    id: "device-control",
    name: "Device control (conductor)",
    description:
      "Drive devices with the conductor CLI: deep links, taps, keyboard, navigation.",
    group: "Device",
    defaultEnabled: false,
    prereqs: ["android_sdk", "playwright"],
    bundled: false,
    lazy: true,
    contributes: {
      ipcGroup: "device-control",
    },
  },
  {
    id: "device-debug",
    name: "Device debug streams",
    description:
      "Tail device logs, memory, and other conductor probes from the Debug panel.",
    group: "Device",
    defaultEnabled: false,
    requires: ["device-control"],
    bundled: false,
    lazy: true,
    contributes: {
      ipcGroup: "device-debug",
      toolRail: [
        {
          id: "debug",
          label: "Debug",
          icon: Icons.BugIcon,
          placement: "bottom",
        },
      ],
    },
  },
];

/** Lookup a manifest by id. Throws if id is not registered. */
export function getPlugin(id: PluginManifest["id"]): PluginManifest {
  const plugin = PLUGINS.find((p) => p.id === id);
  if (!plugin) {
    throw new Error(`Unknown plugin id: ${id}`);
  }

  return plugin;
}
