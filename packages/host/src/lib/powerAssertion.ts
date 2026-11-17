/**
 * A macOS power assertion held through a `caffeinate` child. `-w` ties the
 * child to this process, so a crash can't leave the machine pinned awake.
 *
 * Only node builtins: `serverMode.ts` is leaf-level and uses it.
 */

import { spawn, type ChildProcess } from "node:child_process";

export interface PowerAssertion {
  hold: () => void;
  release: () => void;
  readonly held: boolean;
}

export function powerAssertion(
  flags: string[],
  spawnFn: typeof spawn = spawn,
  platform: NodeJS.Platform = process.platform,
): PowerAssertion {
  let child: ChildProcess | null = null;

  return {
    hold() {
      if (platform !== "darwin" || child) {
        return;
      }
      try {
        const proc = spawnFn(
          "caffeinate",
          [...flags, "-w", String(process.pid)],
          {
            detached: true,
            stdio: "ignore",
          },
        );
        proc.unref();
        proc.on("error", () => {
          if (child === proc) {
            child = null;
          }
        });
        proc.on("exit", () => {
          if (child === proc) {
            child = null;
          }
        });
        child = proc;
      } catch {
        child = null;
      }
    },
    release() {
      if (!child) {
        return;
      }
      const proc = child;
      child = null;
      try {
        proc.kill();
      } catch {
        // Best-effort; `caffeinate -w` exits on its own when we do.
      }
    },
    get held() {
      return child !== null;
    },
  };
}
