import { createLogger } from "@argus/host/logger";
import { appState } from "../../state";
import { stopAgent } from "./agentService";

const log = createLogger("agent:quit");

/**
 * Stop every running agent before the host quits, each bounded by a short
 * timeout so one stuck agent can't hang the quit. Failures are logged and
 * ignored — quitting proceeds either way.
 */
export async function stopAgentsForQuit(timeoutMs = 1500): Promise<void> {
  const running = [...appState.agents]
    .filter(([, agent]) => agent.status === "running")
    .map(([id]) => id);
  log.info(`stopping ${running.length} running agents before quit`);

  await Promise.allSettled(
    running.map(async (id) => {
      try {
        await Promise.race([
          stopAgent(id),
          new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
        ]);
      } catch (err) {
        log.error(`stopAgent(${id}) threw during quit:`, err);
      }
    }),
  );
}
