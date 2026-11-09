/**
 * Runs the account's managed tunnel: one `cloudflared tunnel run` whose ingress
 * the account service pointed at the gateway's loopback port. The connector
 * token rides in the environment, never argv, so `ps` can't show it.
 *
 * Leaf module: it holds the state everything else reads (status, endpoints,
 * presence), while `account/tunnel.ts` decides when it should run and with
 * which credentials.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { notifyTunnelChange } from "./tunnelManager";

export type ManagedTunnelPhase =
  | "error"
  | "installing"
  | "off"
  | "provisioning"
  | "running"
  | "starting"
  | "unavailable";

export type ManagedTunnelOffReason =
  | "account_paused"
  | "not_linked"
  | "remote_off"
  | "turned_off";

export interface ManagedTunnelState {
  phase: ManagedTunnelPhase;
  reason: ManagedTunnelOffReason | null;
  url: string | null;
  error: string | null;
}

export interface ManagedTunnelRun {
  bin: string;
  token: string;
  /** `wss://` address the tunnel's hostname answers on. */
  url: string;
}

export interface SupervisorHooks {
  /** The connector registered with the edge. */
  onRegistered?: () => void;
  /**
   * The connector died. `rejected` when its output says the token or tunnel is
   * gone, which a restart won't fix; `failures` counts exits since it last ran.
   */
  onExit?: (info: { failures: number; rejected: boolean }) => void;
  spawnImpl?: typeof spawn;
  /** Restart delays; the last one repeats. */
  backoffMs?: number[];
}

const REGISTERED_RE =
  /Registered tunnel connection|Connection [0-9a-f-]+ registered/i;
const REJECTED_RE =
  /Unauthorized|Invalid tunnel secret|token is not valid|not a valid tunnel token|tunnel (?:not found|was deleted)|status code: 40[134]/i;
const DEFAULT_BACKOFF_MS = [2_000, 5_000, 15_000, 60_000, 300_000];
/** A connector up this long has proven itself; its failure count resets. */
const HEALTHY_AFTER_MS = 60_000;
const TAIL_LIMIT = 4000;

let state: ManagedTunnelState = {
  phase: "off",
  reason: "not_linked",
  url: null,
  error: null,
};

let child: ChildProcess | null = null;
let current: { run: ManagedTunnelRun; hooks: SupervisorHooks } | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let failures = 0;

export function getManagedTunnelState(): ManagedTunnelState {
  return { ...state };
}

/** The address to publish: only once the connector is registered. */
export function getManagedTunnelUrl(): string | null {
  return state.phase === "running" ? state.url : null;
}

export function setManagedTunnelState(next: Partial<ManagedTunnelState>): void {
  const merged = { ...state, ...next };
  if (
    merged.phase === state.phase &&
    merged.reason === state.reason &&
    merged.url === state.url &&
    merged.error === state.error
  ) {
    return;
  }
  state = merged;
  notifyTunnelChange();
}

/** The token the connector runs with, so a caller can tell "already running". */
export function runningToken(): string | null {
  return current?.run.token ?? null;
}

function lastLines(tail: string): string {
  const lines = tail
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.slice(-3).join("\n").slice(-600);
}

function launch(): void {
  if (!current) {
    return;
  }
  const { run, hooks } = current;
  const spawnImpl = hooks.spawnImpl ?? spawn;
  setManagedTunnelState({ phase: "starting", url: run.url, error: null });
  let proc: ChildProcess;
  try {
    proc = spawnImpl(run.bin, ["tunnel", "--no-autoupdate", "run"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TUNNEL_TOKEN: run.token },
    });
  } catch (err) {
    handleExit(`couldn't start cloudflared: ${(err as Error).message}`, false);

    return;
  }
  child = proc;
  let tail = "";
  let rejected = false;
  let healthyTimer: NodeJS.Timeout | null = null;
  const scan = (buf: Buffer) => {
    const text = buf.toString();
    tail = (tail + text).slice(-TAIL_LIMIT);
    if (REJECTED_RE.test(text)) {
      rejected = true;
    }
    if (REGISTERED_RE.test(text) && state.phase !== "running") {
      setManagedTunnelState({ phase: "running", error: null });
      healthyTimer = setTimeout(() => {
        failures = 0;
      }, HEALTHY_AFTER_MS);
      healthyTimer.unref?.();
      hooks.onRegistered?.();
    }
  };
  proc.stdout?.on("data", scan);
  proc.stderr?.on("data", scan);
  proc.on("error", (err) => {
    if (child !== proc) {
      return;
    }
    child = null;
    if (healthyTimer) {
      clearTimeout(healthyTimer);
    }
    handleExit(`couldn't start cloudflared: ${err.message}`, false);
  });
  proc.on("exit", (code) => {
    if (child !== proc) {
      return;
    }
    child = null;
    if (healthyTimer) {
      clearTimeout(healthyTimer);
    }
    handleExit(
      lastLines(tail) || `cloudflared exited (${code ?? "signal"})`,
      rejected,
    );
  });
}

function handleExit(message: string, rejected: boolean): void {
  if (!current) {
    return;
  }
  failures += 1;
  setManagedTunnelState({ phase: "error", error: message });
  const delays = current.hooks.backoffMs ?? DEFAULT_BACKOFF_MS;
  const delay = delays[Math.min(failures - 1, delays.length - 1)];
  restartTimer = setTimeout(() => {
    restartTimer = null;
    launch();
  }, delay);
  restartTimer.unref?.();
  current.hooks.onExit?.({ failures, rejected });
}

/** Run (or re-run with new credentials) the connector. */
export function startManagedTunnel(
  run: ManagedTunnelRun,
  hooks: SupervisorHooks = {},
): void {
  stopConnector();
  current = { run, hooks };
  failures = 0;
  launch();
}

function stopConnector(): void {
  current = null;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) {
    const proc = child;
    child = null;
    proc.removeAllListeners();
    proc.kill();
    const kill = setTimeout(() => proc.kill("SIGKILL"), 2000);
    kill.unref();
    proc.once("exit", () => clearTimeout(kill));
  }
}

/** Stop the connector; the caller sets the phase it stopped into. */
export function stopManagedTunnel(): void {
  stopConnector();
}

/**
 * For an exit that skips the orderly path: SIGKILL now, since an unref'd
 * escalation timer never fires once the process is going away.
 */
export function killManagedTunnelNow(): void {
  const proc = child;
  stopConnector();
  proc?.kill("SIGKILL");
}
