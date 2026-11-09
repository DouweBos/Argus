/**
 * Claude-style `mcpServers` → ACP `mcpServers`. Every agent takes stdio
 * servers; HTTP ones (Argus's own) only go to agents that say they can.
 */

import type { AcpMcpServer } from "./protocol";
import type { McpServers } from "../../../mcp/userConfig";

export function toAcpMcpServers(
  servers: McpServers,
  http: boolean,
): { servers: AcpMcpServer[]; skipped: string[] } {
  const out: AcpMcpServer[] = [];
  const skipped: string[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    const s = raw as {
      url?: string;
      headers?: Record<string, string>;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    };
    if (typeof s.url === "string") {
      if (!http) {
        skipped.push(name);
        continue;
      }
      out.push({ type: "http", name, url: s.url, headers: pairs(s.headers) });
    } else if (typeof s.command === "string") {
      out.push({
        name,
        command: s.command,
        args: s.args ?? [],
        env: pairs(s.env),
      });
    }
  }

  return { servers: out, skipped };
}

function pairs(
  record: Record<string, string> | undefined,
): { name: string; value: string }[] {
  return Object.entries(record ?? {}).map(([name, value]) => ({
    name,
    value,
  }));
}
