/**
 * The tool registry. One manifest per first-party tool Argus ships.
 *
 * Adding a tool: append a manifest here, add the id to `ToolId` in
 * `types.ts`, and populate the `contributes` field with the actual UI
 * surfaces.
 */

import type { ToolManifest } from "./types";
import { Icons } from "@argus/peacock";

export const TOOLS: readonly ToolManifest[] = [
  {
    id: "device-recording",
    name: "Device recording",
    description:
      "Stream iOS Simulator and Android emulator screens into Argus's runtime panel.",
    group: "Device",
    defaultEnabled: true,
    prereqs: [
      "native_bridge",
      "xcode",
      "ios_runtimes",
      "android_sdk",
      "android_avd",
    ],
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
    defaultEnabled: true,
    requires: ["device-recording"],
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
    defaultEnabled: true,
    prereqs: ["android_sdk", "playwright"],
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
    defaultEnabled: true,
    requires: ["device-control"],
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
export function getTool(id: ToolManifest["id"]): ToolManifest {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) {
    throw new Error(`Unknown tool id: ${id}`);
  }

  return tool;
}
