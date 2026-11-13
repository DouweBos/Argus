/**
 * `$ARGUS_HOME/mcp-endpoint.json`: where the running host's MCP server listens
 * and its bearer token, for the `argus` CLI. Mode 0600 — owning the file is the
 * authentication, the same trust as `host.sock`.
 *
 * Leaf-level (node builtins + `argusHome`) so the CLI bundle stays small.
 */

import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";

export interface McpEndpoint {
  url: string;
  token: string;
  pid: number;
}

export function endpointFilePath(home = argusHomeDir()): string {
  return path.join(home, "mcp-endpoint.json");
}

export function writeEndpointFile(endpoint: McpEndpoint): void {
  const file = endpointFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(endpoint), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Only removes the file while it still names this host, not a newer one. */
export function removeEndpointFile(token: string): void {
  const current = readEndpointFile();
  if (current?.token === token) {
    fs.rmSync(endpointFilePath(), { force: true });
  }
}

export function readEndpointFile(home?: string): McpEndpoint | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(endpointFilePath(home), "utf-8"),
    ) as Partial<McpEndpoint>;
    if (typeof parsed.url !== "string" || typeof parsed.token !== "string") {
      return null;
    }

    return { url: parsed.url, token: parsed.token, pid: parsed.pid ?? 0 };
  } catch {
    return null;
  }
}
