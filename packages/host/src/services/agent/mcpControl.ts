import type { AgentSession } from "./models";
import type { RunnerMcpControl } from "../llm/runners/types";
import { capture as telemetryCapture } from "../telemetry/telemetry";

/** Discovery, client registration and a reconnect can each take a while; a wedged CLI never answers. */
const MCP_CONTROL_TIMEOUT_MS = 30_000;

/** A CLI waits this long at most for a browser sign-in to land on it. */
const SIGN_IN_WINDOW_MS = 15 * 60_000;

const inProgress = new Map<string, number>();
/** Sign-ins handed to the browser, by agent and server, until when. */
const signIns = new Map<string, Map<string, number>>();

/** An MCP action or sign-in is under way, which dies with the CLI. */
export function hasOpenMcpControl(agentId: string, now = Date.now()): boolean {
  return (
    inProgress.has(agentId) ||
    [...(signIns.get(agentId)?.values() ?? [])].some((until) => until > now)
  );
}

export function forgetMcpControl(agentId: string): void {
  inProgress.delete(agentId);
  signIns.delete(agentId);
}

function noteSignIn(
  agentId: string,
  request: RunnerMcpControl,
  authUrl: string | null,
): void {
  const servers = signIns.get(agentId) ?? new Map<string, number>();
  if (request.action === "sign_in" && authUrl) {
    servers.set(request.server, Date.now() + SIGN_IN_WINDOW_MS);
  } else {
    servers.delete(request.server);
  }
  signIns.set(agentId, servers);
}

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
  const { agentId } = agent;
  inProgress.set(agentId, (inProgress.get(agentId) ?? 0) + 1);
  try {
    const result = await Promise.race([control(request), timeout]);
    // The client opens it, so only a web page gets through.
    const authUrl =
      result.authUrl && /^https?:\/\//i.test(result.authUrl)
        ? result.authUrl
        : null;
    noteSignIn(agentId, request, authUrl);
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
    const left = (inProgress.get(agentId) ?? 1) - 1;
    if (left > 0) {
      inProgress.set(agentId, left);
    } else {
      inProgress.delete(agentId);
    }
  }
}
