import type { AgentSession } from "./models";
import type { RemoteMcpServerStatus } from "@argus/remote-protocol";

/** A wedged CLI never answers; the popover would spin forever. */
const MCP_STATUS_TIMEOUT_MS = 5_000;

/**
 * Every MCP server the agent's CLI loaded and whether it connected; null when
 * the runner can't say. A paused agent answers what it last knew.
 */
export async function agentMcpStatus(
  agent: AgentSession,
): Promise<RemoteMcpServerStatus[] | null> {
  return agent.paused ? (agent.mcpServers ?? null) : refreshMcpStatus(agent);
}

/** Ask the live child, and keep the answer for while it's paused. */
export async function refreshMcpStatus(
  agent: AgentSession,
  timeoutMs = MCP_STATUS_TIMEOUT_MS,
): Promise<RemoteMcpServerStatus[] | null> {
  const query = agent.handle.mcpStatus?.bind(agent.handle);
  if (!query) {
    return null;
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("MCP status timed out")),
      timeoutMs,
    );
  });
  try {
    const servers = await Promise.race([query(), timeout]);

    agent.mcpServers = servers.map((s) => ({
      name: s.name,
      status: s.status,
      source: s.source,
      tool_count: s.toolCount,
      error: s.error,
    }));

    return agent.mcpServers;
  } finally {
    clearTimeout(timer);
  }
}
