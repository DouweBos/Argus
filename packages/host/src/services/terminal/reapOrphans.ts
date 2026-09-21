/**
 * Startup sweep for orphaned `node-pty` spawn-helpers from previous Argus
 * runs. SIGKILL'd / crashed dev processes can't run our `before-quit` /
 * signal handlers, so the helpers reparent to launchd and accumulate over
 * time. On boot, find any that match an Argus install path and reap them.
 */

import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { info, warn } from "@argus/host/logger";

const execFileAsync = promisify(execFile);

/**
 * Scan the process table for `spawn-helper` processes living under an
 * Argus-controlled `node_modules` path (the main repo's checkout or any
 * worktree under `~/.argus/worktrees`) whose parent is PID 1, and SIGKILL
 * them. Best-effort; failures are logged but never thrown.
 */
export async function reapOrphanedSpawnHelpers(): Promise<void> {
  let stdout: string;
  try {
    // ps with no width limit; ppid first so awk can filter cheaply.
    const result = await execFileAsync("ps", ["-eo", "pid=,ppid=,command="]);
    stdout = result.stdout;
  } catch (err) {
    warn("reapOrphanedSpawnHelpers: ps failed: %s", err);

    return;
  }

  const homeWorktrees = `${os.homedir()}/.argus/worktrees/`;
  const victims: number[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    // Format: "<pid> <ppid> <command...>"
    const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }
    const [, pidStr, ppidStr, command] = match;
    if (ppidStr !== "1") {
      continue;
    }
    if (!command.includes("node-pty") || !command.includes("spawn-helper")) {
      continue;
    }
    if (!command.includes(homeWorktrees) && !command.includes("/Argus/")) {
      // Restrict to paths we're confident belong to Argus. Don't touch
      // spawn-helpers from unrelated tools that happen to use node-pty.
      continue;
    }
    const pid = Number(pidStr);
    if (Number.isFinite(pid) && pid > 1) {
      victims.push(pid);
    }
  }

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
