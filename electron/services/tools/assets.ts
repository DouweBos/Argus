/**
 * Tool asset resolver.
 *
 * Tools ship bundled — `extraResources` includes every asset. In packaged
 * builds the asset lives under `process.resourcesPath`; in dev it's read
 * straight from the in-repo build output. The tool store still gates *use*
 * of these assets behind the user's enable toggle, but resolving a path
 * never touches the network.
 */

import { app } from "electron";
import path from "node:path";

interface AssetSpec {
  /** Filename or directory name under `process.resourcesPath` when packaged. */
  name: string;
  /** Repo-relative path to the build output the resolver reads in dev. */
  source: string;
}

const ASSET_SPECS: Record<string, AssetSpec> = {
  "argus-sim-bridge": {
    name: "argus-sim-bridge",
    source: "native/argus-sim-bridge/argus-sim-bridge",
  },
  "scrcpy-server.jar": {
    name: "scrcpy-server.jar",
    source: "native/scrcpy-server/scrcpy-server.jar",
  },
  conductor: {
    name: "conductor",
    source: "native/conductor",
  },
};

/** Resolve the absolute path to a bundled tool asset by its basename. */
export function resolveAssetPath(assetName: string): string {
  const spec = ASSET_SPECS[assetName];
  if (!spec) {
    throw new Error(
      `Tool asset not registered: ${assetName} (no resolver entry)`,
    );
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, spec.name);
  }

  return path.join(process.cwd(), spec.source);
}
