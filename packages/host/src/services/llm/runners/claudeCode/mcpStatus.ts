import type {
  RunnerMcpControl,
  RunnerMcpControlResult,
  RunnerMcpServerStatus,
} from "../types";
import type { McpControlPayload } from "./protocol";

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

export function mcpControlPayload(
  request: RunnerMcpControl,
): McpControlPayload {
  const serverName = request.server;
  switch (request.action) {
    case "reconnect":
      return { subtype: "mcp_reconnect", serverName };
    case "enable":
    case "disable":
      return {
        subtype: "mcp_toggle",
        serverName,
        enabled: request.action === "enable",
      };
    case "sign_in":
      return { subtype: "mcp_authenticate", serverName };
    case "finish_sign_in":
      return {
        subtype: "mcp_oauth_callback_url",
        serverName,
        callbackUrl: request.callbackUrl,
      };
  }
}

/** `mcp_authenticate` answers with the page to sign in on; the rest answer nothing. */
export function parseMcpControlResult(
  response: Record<string, unknown> | undefined,
): RunnerMcpControlResult {
  const authUrl = response?.authUrl;

  return {
    authUrl: typeof authUrl === "string" && authUrl ? authUrl : null,
    callbackExpected: response?.callbackExpected === true,
  };
}
