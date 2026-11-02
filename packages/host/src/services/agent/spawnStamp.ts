import type { Session } from "../session/models";
import { createHash } from "node:crypto";
import { getMcpPort } from "../mcp/server";
import { buildMergedMcpServers } from "../mcp/userConfig";
import { loadArgusConfig } from "../session/argusConfig";
import { deviceControlEnabled } from "./runtimePrompt";

/**
 * A hash of the config a spawn reads besides runner and account — the
 * project's browser URL, whether device control is on (it gates the
 * conductor guide), and every MCP server — so a spare spawned before any of it changed is never
 * handed out.
 */
export async function spawnConfigStamp(
  session: Session & { path: string },
): Promise<string> {
  let config: Record<string, unknown> = {};
  let projectTools: { disabled?: string[] } | null = null;
  try {
    const { browser_url, tools } = loadArgusConfig(session.repo_root);
    config = { browser_url };
    projectTools = tools ?? null;
  } catch {
    // Missing or invalid — the spawn falls back the same way.
  }
  const mcp = await buildMergedMcpServers(session.path);

  return createHash("sha256")
    .update(
      JSON.stringify({
        config,
        mcp,
        mcpPort: getMcpPort(),
        deviceControl: deviceControlEnabled(projectTools),
      }),
    )
    .digest("hex");
}
