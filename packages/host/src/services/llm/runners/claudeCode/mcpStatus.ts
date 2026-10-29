import type { RunnerMcpServerStatus } from "../types";

/** The CLI's `mcp_status` response, minus configs (they can hold secrets). */
export function parseMcpStatus(
  response: Record<string, unknown> | undefined,
): RunnerMcpServerStatus[] {
  const servers = response?.mcpServers;
  if (!Array.isArray(servers)) {
    return [];
  }

  return servers.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== "object") {
      return [];
    }
    const s = raw as Record<string, unknown>;
    if (typeof s.name !== "string") {
      return [];
    }

    return [
      {
        name: s.name,
        status: typeof s.status === "string" ? s.status : "unknown",
        source: typeof s.source === "string" ? s.source : null,
        toolCount: Array.isArray(s.tools) ? s.tools.length : null,
        error: typeof s.error === "string" ? s.error : null,
      },
    ];
  });
}
