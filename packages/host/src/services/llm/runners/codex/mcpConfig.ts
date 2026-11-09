/**
 * Claude-style `mcpServers` → Codex `mcp_servers` config. Codex names the
 * same fields differently (`http_headers`) and times tools out after 60s,
 * which would cut `wait_for_agent` and friends short.
 */

import type { McpServers } from "../../../mcp/userConfig";

const TOOL_TIMEOUT_SEC = 86_400;

export function toCodexMcpServers(
  servers: McpServers,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, raw] of Object.entries(servers)) {
    const s = raw as {
      type?: string;
      url?: string;
      headers?: Record<string, string>;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    };
    if (typeof s.url === "string") {
      out[name] = {
        url: s.url,
        ...(s.headers ? { http_headers: s.headers } : {}),
        tool_timeout_sec: TOOL_TIMEOUT_SEC,
      };
    } else if (typeof s.command === "string") {
      out[name] = {
        command: s.command,
        args: s.args ?? [],
        ...(s.env ? { env: s.env } : {}),
        tool_timeout_sec: TOOL_TIMEOUT_SEC,
      };
    }
  }

  return out;
}
