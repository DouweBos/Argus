import type { ChildProcess } from "node:child_process";
import { info } from "@argus/host/logger";

const TERM_GRACE_MS = 2000;
const KILL_GRACE_MS = 1000;
/** A grandchild can hold the pipes open, so `close` may trail `exit` forever. */
const DRAIN_MS = 250;

/** Whether the OS reaped it; a signalled child has no exit code. */
export function hasExited(child: ChildProcess): boolean {
  return (child.exitCode ?? child.signalCode ?? null) !== null;
}

/** SIGTERM, then SIGKILL if the child is still running two seconds later. */
export async function killChild(
  child: ChildProcess,
  agentId: string,
): Promise<void> {
  if (hasExited(child)) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
    child.once("exit", () => setTimeout(resolve, DRAIN_MS));
  });
  try {
    child.kill();
  } catch (e) {
    info(`[agent:${agentId}] child.kill() returned: ${String(e)}`);
  }
  await Promise.race([exited, delay(TERM_GRACE_MS)]);
  if (!hasExited(child) && child.pid !== undefined) {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
    await Promise.race([exited, delay(KILL_GRACE_MS)]);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
