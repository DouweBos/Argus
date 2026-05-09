/**
 * Startup sweep for orphaned Claude Code CLI subprocesses from previous
 * Argus runs. Each agent passes `--debug-file ~/.argus/agents/<id>.debug.log`,
 * which makes them easy to identify in the process table without confusing
 * them with claude processes the user spawned in their terminal.
 *
 * Why this is needed: `handle.kill()` sends SIGTERM and (now) escalates to
 * SIGKILL on a 2 s timeout, but a hard crash / SIGKILL of the Argus main
 * process bypasses that path entirely. Without this reaper, MCP-blocked
 * claude children reparent to launchd and accumulate forever.
 */

import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { info, warn } from "../../../app/lib/logger";

const execFileAsync = promisify(execFile);

export async function reapOrphanedAgentProcesses(): Promise<void> {
  let stdout: string;
  try {
    const result = await execFileAsync("ps", ["-eo", "pid=,ppid=,command="]);
    stdout = result.stdout;
  } catch (err) {
    warn("reapOrphanedAgentProcesses: ps failed: %s", err);

    return;
  }

  const argusAgentsDir = `${os.homedir()}/.argus/agents/`;
  const victims: number[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }
    const [, pidStr, ppidStr, command] = match;
    if (ppidStr !== "1") {
      continue;
    }
    // Match the exact debug-file argument the agent service passes when
    // spawning claude — narrow enough to leave the user's own claude
    // sessions alone.
    if (!command.includes(`--debug-file ${argusAgentsDir}`)) {
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

  info("reapOrphanedAgentProcesses: killing %d orphan(s)", victims.length);
  for (const pid of victims) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ESRCH/EPERM — gone or not ours; ignorable.
    }
  }
}
