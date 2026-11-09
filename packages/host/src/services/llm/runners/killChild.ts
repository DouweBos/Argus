import type { ChildProcess } from "node:child_process";
import { info } from "@argus/host/logger";

/** SIGTERM, then SIGKILL if the child hasn't closed within two seconds. */
export async function killChild(
  child: ChildProcess,
  agentId: string,
): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
  });
  try {
    child.kill();
  } catch (e) {
    info(`[agent:${agentId}] child.kill() returned: ${String(e)}`);
  }
  await Promise.race([exited, delay(2000)]);
  if (child.exitCode === null && child.pid !== undefined) {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
    await Promise.race([exited, delay(1000)]);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
