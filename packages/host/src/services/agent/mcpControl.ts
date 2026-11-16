import type { AgentSession } from "./models";
import type { RunnerMcpControl } from "../llm/runners/types";
import { capture as telemetryCapture } from "../telemetry/telemetry";

/** Discovery, client registration and a reconnect can each take a while; a wedged CLI never answers. */
const MCP_CONTROL_TIMEOUT_MS = 30_000;

export interface McpControlOutcome {
  /** The page to sign in on, for the client to open; null when there's none. */
  authUrl: string | null;
  /** False for claude.ai connectors: reconnect once signed in. */
  callbackExpected: boolean;
}

/** Reconnect, enable, disable or sign in to one of the agent's MCP servers, as `/mcp` does in a terminal. */
export async function agentMcpControl(
  agent: AgentSession,
  request: RunnerMcpControl,
): Promise<McpControlOutcome> {
  const control = agent.handle.mcpControl?.bind(agent.handle);
  if (!control) {
    throw "This agent's runner can't manage its MCP servers";
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("The agent didn't answer in time")),
      MCP_CONTROL_TIMEOUT_MS,
    );
  });
  try {
    const result = await Promise.race([control(request), timeout]);
    // The client opens it, so only a web page gets through.
    const authUrl =
      result.authUrl && /^https?:\/\//i.test(result.authUrl)
        ? result.authUrl
        : null;
    telemetryCapture("agent_mcp_server_acted", {
      action: request.action,
      success: true,
    });

    return { authUrl, callbackExpected: result.callbackExpected };
  } catch (error) {
    telemetryCapture("agent_mcp_server_acted", {
      action: request.action,
      success: false,
    });
    throw error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timer);
  }
}
