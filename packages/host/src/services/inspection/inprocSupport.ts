/**
 * Whether conductor can inject its in-process inspection library on a device.
 *
 * Conductor resolves `<drivers>/<ios|tvos>-inproc/Conductor.framework`, with
 * `<drivers>` either a dev build's `drivers/` or the release tarball unpacked
 * into `~/.conductor/drivers/<version>/`. Its releases only build the iOS one,
 * so a tvOS launch with `--inject` fails until a release ships `tvos-inproc`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConductorDir } from "../cli/conductor";
import { listSimulators } from "../simulator/ios";

export type InprocPlatform = "ios" | "tvos";

export const TVOS_INPROC_UNAVAILABLE =
  "Inspection isn't available for tvOS apps yet: this version of Conductor doesn't include the tvOS inspection library.";

/**
 * Where conductor will look for the library, or null while its driver cache
 * hasn't been downloaded yet (conductor fetches it on first use).
 */
export function inprocLibraryPath(
  platform: InprocPlatform,
  conductorDir: string = getConductorDir(),
  home: string = os.homedir(),
): string | null {
  const pkgRoot = path.join(
    conductorDir,
    "node_modules",
    "@houwert",
    "conductor",
  );
  const lib = (dir: string) =>
    path.join(dir, `${platform}-inproc`, "Conductor.framework", "Conductor");

  const devDrivers = path.join(pkgRoot, "drivers");
  if (fs.existsSync(devDrivers)) {
    return lib(devDrivers);
  }
  let version: string;
  try {
    version = (
      JSON.parse(
        fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"),
      ) as { version: string }
    ).version;
  } catch {
    return null;
  }
  const cache = path.join(home, ".conductor", "drivers", version);

  return fs.existsSync(path.join(cache, ".complete")) ? lib(cache) : null;
}

/** Why `launch-app --inject` can't work on this platform, or null if it can. */
export function inprocUnavailableReason(
  platform: InprocPlatform,
  libraryPath: string | null = inprocLibraryPath(platform),
): string | null {
  // iOS ships in every release; an unknown path means conductor hasn't
  // fetched its drivers yet, and will on the launch itself.
  if (platform !== "tvos" || libraryPath === null) {
    return null;
  }

  return fs.existsSync(libraryPath) ? null : TVOS_INPROC_UNAVAILABLE;
}

/** The simulator's platform, from its runtime; iOS when it can't be told. */
export async function simulatorPlatform(udid: string): Promise<InprocPlatform> {
  const sims = await listSimulators().catch(() => []);
  const runtime = sims.find((s) => s.udid === udid)?.runtime ?? "";

  return runtime.toLowerCase().includes("tvos") ? "tvos" : "ios";
}

/** Conductor's "library not found" failure, said in a sentence. */
export function friendlyInjectError(
  message: string,
  platform: InprocPlatform,
): string {
  if (!message.includes("in-process library not found")) {
    return message;
  }

  return platform === "tvos"
    ? TVOS_INPROC_UNAVAILABLE
    : "Inspection couldn't start: Conductor's iOS inspection library is missing.";
}
