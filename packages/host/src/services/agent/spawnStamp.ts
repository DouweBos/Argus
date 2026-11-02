import type { Session } from "../session/models";
import { createHash } from "node:crypto";
import { getMcpPort } from "../mcp/server";
import { buildMergedMcpServers } from "../mcp/userConfig";
import { loadArgusConfig } from "../session/argusConfig";
import { conductorGuideEnabled } from "./runtimePrompt";

/**
 * A hash of the config a spawn reads besides runner and account — the
 * project's agent prompt and browser URL, the conductor-guide setting, and
 * every MCP server — so a spare spawned before any of it changed is never
 * handed out.
 */
export async function spawnConfigStamp(
  session: Session & { path: string },
): Promise<string> {
  let config: Record<string, unknown> = {};
  try {
    const { agent_prompt, browser_url } = loadArgusConfig(session.repo_root);
    config = { agent_prompt, browser_url };
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
        conductorGuide: conductorGuideEnabled(),
      }),
    )
    .digest("hex");
}
