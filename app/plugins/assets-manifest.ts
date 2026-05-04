/**
 * Single source of truth for downloadable plugin assets.
 *
 * Used by three call sites that previously had their own copies of this data:
 *   - `electron/services/plugins/assets.ts` — runtime resolver + downloader.
 *   - `scripts/release-plugins.ts` — CI release pipeline (zip + notarize + upload).
 *   - `app/plugins/registry.ts` — exposes assets on each plugin's manifest.
 *
 * Adding a new plugin asset = one entry here.
 *
 * This module is plain data + helpers. It deliberately depends only on the
 * `PluginId` type so it can be imported from the renderer, the main process,
 * and Node CI scripts (which can't pull in `@argus/peacock` or React).
 */

import type { PluginId } from "./types";

export type PluginAssetKind = "data" | "jar" | "native" | "node";

export interface PluginAssetSpec {
  /** chmod +x after extraction (Mach-O binaries). */
  executable?: boolean;
  kind: PluginAssetKind;
  /**
   * Filename or directory name as the resolver, cache, and download URL use it.
   * Also the basename under `process.resourcesPath` when the asset is bundled
   * via electron-builder `extraResources`.
   */
  name: string;
  pluginId: PluginId;
  /** Repo-relative path to the build output the release script zips. */
  source: string;
}

export const PLUGIN_ASSETS: readonly PluginAssetSpec[] = [
  {
    pluginId: "device-recording",
    name: "argus-sim-bridge",
    kind: "native",
    executable: true,
    source: "native/argus-sim-bridge/argus-sim-bridge",
  },
  {
    pluginId: "device-recording",
    name: "scrcpy-server.jar",
    kind: "jar",
    source: "native/scrcpy-server/scrcpy-server.jar",
  },
  {
    pluginId: "device-control",
    name: "conductor",
    kind: "node",
    source: "native/conductor",
  },
];

/** Assets owned by a single plugin, in declaration order. */
export function pluginAssets(id: PluginId): readonly PluginAssetSpec[] {
  return PLUGIN_ASSETS.filter((a) => a.pluginId === id);
}

/**
 * Native binaries are arch/platform-specific Mach-O / ELF / PE files; everything
 * else (jars, node trees, data) is portable. Drives the release-zip naming and
 * the runtime download URL.
 */
export function needsArchSuffix(kind: PluginAssetKind): boolean {
  return kind === "native";
}

/** Only native binaries need codesign + notarize on macOS. */
export function needsNotarization(kind: PluginAssetKind): boolean {
  return kind === "native";
}
