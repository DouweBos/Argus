/**
 * Third-party binaries and scripts the host ships with: ripgrep and the
 * bundled language servers. A packaged host finds them under
 * `ARGUS_RESOURCES` (staged by `scripts/build-mac-host.ts`); a checkout reads
 * them straight from the host package's `node_modules`.
 */

import fs from "node:fs";
import path from "node:path";
import { checkoutRoot } from "@argus/host/lib/checkoutRoot";
import { hostPlatform } from "@argus/host/platform";

/** Under the resources dir in a packaged host. */
export const PACKAGED_RG = "rg";
export const PACKAGED_LANGUAGE_SERVERS = "language-servers";

function hostNodeModules(): string {
  return path.join(checkoutRoot(), "packages", "host", "node_modules");
}

/** `packaged` under the resources dir, else `dev` under the host's node_modules. */
export function bundledPath(packaged: string, dev: string): string {
  if (hostPlatform().isPackaged()) {
    return path.join(hostPlatform().resourcesPath(), packaged);
  }

  return path.join(hostNodeModules(), dev);
}

/**
 * `@vscode/ripgrep` ships the binary as a per-platform optional dependency,
 * installed next to it.
 */
export function ripgrepPath(): string {
  if (process.env.ARGUS_RG_PATH) {
    return process.env.ARGUS_RG_PATH;
  }
  if (hostPlatform().isPackaged()) {
    return path.join(hostPlatform().resourcesPath(), PACKAGED_RG);
  }
  const pkg = path.join(hostNodeModules(), "@vscode", "ripgrep");
  const real = fs.existsSync(pkg) ? fs.realpathSync(pkg) : pkg;

  return path.join(
    path.dirname(real),
    `ripgrep-${process.platform}-${process.arch}`,
    "bin",
    process.platform === "win32" ? "rg.exe" : "rg",
  );
}
