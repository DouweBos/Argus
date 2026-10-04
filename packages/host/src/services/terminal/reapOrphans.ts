/**
 * Startup sweep for orphaned `node-pty` spawn-helpers from this host's
 * previous run. SIGKILL'd / crashed processes can't run our `before-quit` /
 * signal handlers, so the helpers reparent to launchd and accumulate over
 * time. Only pids this host recorded are touched: another Argus on the same
 * Mac (a second `ARGUS_HOME`) keeps its own.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { info, warn } from "@argus/host/logger";
import { takePtyLedger } from "./ptyLedger";

const execFileAsync = promisify(execFile);

/**
 * The orphaned spawn-helpers in a `ps -eo pid=,ppid=,command=` listing that
 * this host started — reparented to PID 1 and still running the helper, so a
 * recycled pid is never mistaken for one.
 */
export function orphanedHelpers(ps: string, ours: Set<number>): number[] {
  const victims: number[] = [];
  for (const line of ps.split("\n")) {
    const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line.trim());
    if (!match) {
      continue;
    }
    const [, pidStr, ppidStr, command] = match;
    const pid = Number(pidStr);
    if (
      ppidStr === "1" &&
      ours.has(pid) &&
      command.includes("node-pty") &&
      command.includes("spawn-helper")
    ) {
      victims.push(pid);
    }
  }

  return victims;
}

/** Best-effort; failures are logged but never thrown. */
export async function reapOrphanedSpawnHelpers(): Promise<void> {
  const ours = new Set(takePtyLedger());
  if (ours.size === 0) {
    return;
  }
  let stdout: string;
  try {
    const result = await execFileAsync("ps", ["-eo", "pid=,ppid=,command="]);
    stdout = result.stdout;
  } catch (err) {
    warn("reapOrphanedSpawnHelpers: ps failed: %s", err);

    return;
  }

  const victims = orphanedHelpers(stdout, ours);
  if (victims.length === 0) {
    return;
  }

  info("reapOrphanedSpawnHelpers: killing %d orphan(s)", victims.length);
  for (const pid of victims) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ESRCH: gone already; EPERM: not ours — both ignorable.
    }
  }
}
