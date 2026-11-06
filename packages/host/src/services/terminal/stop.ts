/**
 * Graceful terminal stop: Ctrl-C first, then SIGTERM, then SIGKILL, aimed at
 * process groups so wrapper chains (`pnpm` → `turbo` → `vite`) all get the
 * signal and nothing survives the PTY to reparent to launchd.
 */

import type { TerminalSession } from "./multiplexer";
import { execFile } from "node:child_process";
import os from "node:os";
import { appState } from "../../state";
import { capture } from "../telemetry/telemetry";

export type StopStep = "SIGINT" | "SIGKILL" | "SIGTERM";
/** Who asked for the stop, for telemetry. */
export type StopSource = "mcp" | "rerun" | "ui";

const STEPS: StopStep[] = ["SIGINT", "SIGTERM", "SIGKILL"];

/** Default wait after each signal before escalating. */
export const DEFAULT_STOP_GRACE_MS = 3000;
const MAX_STOP_GRACE_MS = 30_000;
/** How long to wait for the kernel to tear down after SIGKILL. */
const KILL_SETTLE_MS = 2000;
const POLL_MS = 100;

export interface TerminalStopOutcome {
  /** True once the PTY has exited and no process from its tree is left. */
  stopped: boolean;
  /** The terminal had already exited before the call; nothing was signalled. */
  alreadyExited: boolean;
  /** The last signal sent, i.e. the escalation step that finished it. */
  step: StopStep | null;
  exitCode: number | null;
  /** Signal name the PTY's process died from, when it died from one. */
  exitSignal: string | null;
  /** Pids from the run still alive after SIGKILL (should be empty). */
  survivors: number[];
}

interface ProcRow {
  pid: number;
  ppid: number;
  pgid: number;
  tpgid: number;
  zombie: boolean;
}

function listProcesses(): Promise<ProcRow[]> {
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-A", "-o", "pid=,ppid=,pgid=,tpgid=,stat="],
      { maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);

          return;
        }
        const rows: ProcRow[] = [];
        for (const line of stdout.split("\n")) {
          const [pid, ppid, pgid, tpgid, stat] = line.trim().split(/\s+/);
          if (!stat) {
            continue;
          }
          rows.push({
            pid: Number(pid),
            ppid: Number(ppid),
            pgid: Number(pgid),
            tpgid: Number(tpgid),
            zombie: stat.startsWith("Z"),
          });
        }
        resolve(rows);
      },
    );
  });
}

/**
 * Tracks the process groups belonging to one terminal's run. Groups are kept
 * once seen, so children orphaned when the shell dies are still found.
 */
class RunTree {
  private readonly pgids = new Set<number>();
  private hostPgid: number | null = null;

  constructor(private readonly rootPid: number) {
    this.pgids.add(rootPid);
  }

  /** Live (non-zombie) members of the run, refreshed from `ps`. */
  async snapshot(): Promise<{ members: ProcRow[]; foreground: number | null }> {
    const rows = await listProcesses();
    const byParent = new Map<number, ProcRow[]>();
    for (const row of rows) {
      byParent.set(row.ppid, [...(byParent.get(row.ppid) ?? []), row]);
      if (row.pid === process.pid) {
        this.hostPgid = row.pgid;
      }
    }

    const root = rows.find((r) => r.pid === this.rootPid);
    const inTree = new Set<number>();
    const queue = root ? [root] : [];
    while (queue.length > 0) {
      const row = queue.shift()!;
      inTree.add(row.pid);
      this.addGroup(row.pgid);
      queue.push(...(byParent.get(row.pid) ?? []));
    }

    const members = rows.filter(
      (r) => !r.zombie && (inTree.has(r.pid) || this.pgids.has(r.pgid)),
    );
    const foreground = root && root.tpgid > 0 ? root.tpgid : null;

    return { members, foreground };
  }

  private addGroup(pgid: number): void {
    if (pgid > 1 && pgid !== this.hostPgid) {
      this.pgids.add(pgid);
    }
  }

  /** Signal every group of the run, plus stray members outside them. */
  signalAll(signal: StopStep, members: ProcRow[]): void {
    for (const pgid of this.pgids) {
      sendSignal(-pgid, signal);
    }
    for (const m of members) {
      if (!this.pgids.has(m.pgid)) {
        sendSignal(m.pid, signal);
      }
    }
  }
}

function sendSignal(target: number, signal: StopStep): void {
  try {
    process.kill(target, signal);
  } catch {
    // ESRCH: already gone.
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms).unref?.());

/** Wait until the PTY has exited and the run has no live members, or the deadline. */
async function waitForQuiet(
  terminal: TerminalSession,
  tree: RunTree,
  ms: number,
): Promise<ProcRow[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const { members } = await tree.snapshot();
    if (terminal.exitCode !== null && members.length === 0) {
      return [];
    }
    if (Date.now() >= deadline) {
      return members;
    }
    await sleep(POLL_MS);
  }
}

/** Name for a numeric signal, e.g. 2 → "SIGINT". */
export function signalName(signal: number): string {
  const entry = Object.entries(os.constants.signals).find(
    ([, n]) => n === signal,
  );

  return entry ? entry[0] : `signal ${signal}`;
}

const inFlight = new Map<string, Promise<TerminalStopOutcome>>();

/**
 * Stop a terminal the way Ctrl-C would, escalating until its whole process
 * tree is gone. Concurrent calls for one terminal share a single escalation.
 *
 * @throws A plain string if the terminal is not found.
 */
export function stopTerminalGracefully(
  terminalId: string,
  source: StopSource,
  graceMs = DEFAULT_STOP_GRACE_MS,
): Promise<TerminalStopOutcome> {
  const terminal = appState.terminals.get(terminalId);
  if (!terminal) {
    throw `Terminal session not found: ${terminalId}`;
  }
  if (terminal.exitCode !== null) {
    return Promise.resolve({
      stopped: true,
      alreadyExited: true,
      step: null,
      exitCode: terminal.exitCode,
      exitSignal: terminal.exitSignal,
      survivors: [],
    });
  }
  const pending = inFlight.get(terminalId);
  if (pending) {
    return pending;
  }

  const grace = Math.min(Math.max(graceMs, 0), MAX_STOP_GRACE_MS);
  const run = escalate(terminal, grace)
    .then((outcome) => {
      if (outcome.step) {
        capture("terminal_stopped", {
          source,
          step: outcome.step,
          stopped: outcome.stopped,
        });
      }

      return outcome;
    })
    .finally(() => inFlight.delete(terminalId));
  inFlight.set(terminalId, run);

  return run;
}

async function escalate(
  terminal: TerminalSession,
  graceMs: number,
): Promise<TerminalStopOutcome> {
  const tree = new RunTree(terminal.pid);
  let survivors: ProcRow[] = [];
  let step: StopStep | null = null;

  for (const signal of STEPS) {
    const { members, foreground } = await tree.snapshot();
    if (terminal.exitCode !== null && members.length === 0) {
      break;
    }
    step = signal;
    if (signal === "SIGINT") {
      // Exactly what the tty does on Ctrl-C: the foreground group only.
      sendSignal(-(foreground ?? terminal.pid), signal);
    } else {
      tree.signalAll(signal, members);
    }
    survivors = await waitForQuiet(
      terminal,
      tree,
      signal === "SIGKILL" ? KILL_SETTLE_MS : graceMs,
    );
    if (survivors.length === 0) {
      break;
    }
  }

  return {
    stopped: terminal.exitCode !== null && survivors.length === 0,
    alreadyExited: false,
    step,
    exitCode: terminal.exitCode,
    exitSignal: terminal.exitSignal,
    survivors: survivors.map((s) => s.pid),
  };
}
