/**
 * Restore the execute bit on node-pty's prebuilt `spawn-helper`.
 *
 * node-pty looks for its native module in `build/Release`, then `build/Debug`,
 * then `prebuilds/<platform>-<arch>`. A machine that compiles it gets an
 * executable helper and never notices; an install that takes the prebuild gets
 * one shipped `rw-r--r--`, and every PTY then dies inside node-pty as a bare
 * `posix_spawnp failed` that names neither the file nor the reason.
 *
 * That is the difference between a developer's checkout and CI, so it reads as
 * "works locally, fails in CI" — terminals, run commands and the setup
 * pipeline all gone, with nothing to go on. One chmod, every install.
 */
import {
  chmodSync,
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { error, info } from "@argus/host/logger";

const ROOT = join(import.meta.dirname, "..");

/** Every installed copy of node-pty, which the global virtual store keeps outside the repo. */
function nodePtyRoots(): string[] {
  const links = [ROOT, join(ROOT, "packages", "host")]
    .map((dir) => join(dir, "node_modules", "node-pty"))
    .filter((link) => existsSync(link));

  return [...new Set(links.map((link) => realpathSync(link)))];
}

function helpersIn(nodePty: string): string[] {
  const prebuilds = join(nodePty, "prebuilds");
  if (!existsSync(prebuilds)) {
    return [];
  }

  return readdirSync(prebuilds)
    .map((platform) => join(prebuilds, platform, "spawn-helper"))
    .filter((helper) => existsSync(helper));
}

function main(): void {
  let fixed = 0;
  for (const nodePty of nodePtyRoots()) {
    for (const helper of helpersIn(nodePty)) {
      // 0o111 is the execute bit for user, group and other.
      const mode = statSync(helper).mode;
      if ((mode & 0o111) === 0o111) {
        continue;
      }
      try {
        chmodSync(helper, mode | 0o111);
        fixed += 1;
      } catch (e) {
        // Not fatal: a machine that compiled node-pty never reads these.
        error(`Could not chmod ${helper}: ${String(e)}`);
      }
    }
  }
  if (fixed > 0) {
    info(`Made ${fixed} node-pty spawn-helper binaries executable`);
  }
}

main();
