/**
 * Claude-style `mcpServers` → ACP `mcpServers`. Every agent takes stdio
 * servers; HTTP ones (Argus's own) go as-is to agents that say they can, and
 * through the `argus-mcp-stdio` bridge to the rest.
 */

import type { AcpMcpServer } from "./protocol";
import type { McpServers } from "../../../mcp/userConfig";
import fs from "node:fs";
import path from "node:path";
import { checkoutRoot } from "@argus/host/lib/checkoutRoot";
import { BRIDGE_HEADERS_ENV, BRIDGE_URL_ENV } from "../../../mcp/stdioBridge";

export interface StdioBridge {
  command: string;
  args: string[];
}

export const BRIDGE_SCRIPT = "argus-mcp-stdio.js";

/** The bridge next to the host bundle, or a checkout's `dist-host` build. */
export function stdioBridge(): StdioBridge | null {
  const script = [
    path.join(__dirname, BRIDGE_SCRIPT),
    path.join(checkoutRoot(), "dist-host", BRIDGE_SCRIPT),
  ].find((p) => fs.existsSync(p));

  return script ? { command: process.execPath, args: [script] } : null;
}

export function toAcpMcpServers(
  servers: McpServers,
  http: boolean,
  bridge: StdioBridge | null = null,
): { servers: AcpMcpServer[]; skipped: string[]; bridged: string[] } {
  const out: AcpMcpServer[] = [];
  const skipped: string[] = [];
  const bridged: string[] = [];
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
        if (!bridge) {
          skipped.push(name);
          continue;
        }
        out.push({
          name,
          command: bridge.command,
          args: bridge.args,
          env: pairs({
            [BRIDGE_URL_ENV]: s.url,
            [BRIDGE_HEADERS_ENV]: JSON.stringify(s.headers ?? {}),
          }),
        });
        bridged.push(name);
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

  return { servers: out, skipped, bridged };
}

function pairs(
  record: Record<string, string> | undefined,
): { name: string; value: string }[] {
  return Object.entries(record ?? {}).map(([name, value]) => ({
    name,
    value,
  }));
}
