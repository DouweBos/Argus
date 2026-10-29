import type { AgentSession } from "./models";
import type { RemoteMcpServerStatus } from "@argus/remote-protocol";

/** A wedged CLI never answers; the popover would spin forever. */
const MCP_STATUS_TIMEOUT_MS = 5_000;

/** Every MCP server the agent's CLI loaded and whether it connected; null when the runner can't say. */
export async function agentMcpStatus(
  agent: AgentSession,
): Promise<RemoteMcpServerStatus[] | null> {
  const query = agent.handle.mcpStatus?.bind(agent.handle);
  if (!query) {
    return null;
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("MCP status timed out")),
      MCP_STATUS_TIMEOUT_MS,
    );
  });
  try {
    const servers = await Promise.race([query(), timeout]);

    return servers.map((s) => ({
      name: s.name,
      status: s.status,
      source: s.source,
      tool_count: s.toolCount,
      error: s.error,
    }));
  } finally {
    clearTimeout(timer);
  }
}
