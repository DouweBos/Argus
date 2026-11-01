/**
 * An agent's MCP servers as a list shows them: state, name, origin, sorted
 * with what needs you first. The TS twin of ArgusCore's `AgentMcpServers`.
 */

import type { RemoteMcpServerStatus } from "@argus/remote-protocol";

export type McpServerState =
  | "connected"
  | "disabled"
  | "failed"
  | "needs-auth"
  | "other"
  | "pending";

export interface McpServerView {
  /** The CLI's name, unique per agent. */
  name: string;
  /** `plugin:team-tools:linear` reads as `linear`. */
  displayName: string;
  state: McpServerState;
  stateLabel: string;
  /** The failure, or origin and tool count. */
  detail: string | null;
}

const KNOWN: McpServerState[] = [
  "connected",
  "pending",
  "needs-auth",
  "failed",
  "disabled",
];

const RANK: Record<McpServerState, number> = {
  failed: 0,
  "needs-auth": 1,
  other: 2,
  pending: 3,
  connected: 4,
  disabled: 5,
};

const LABELS: Record<Exclude<McpServerState, "other">, string> = {
  connected: "Connected",
  pending: "Connecting",
  "needs-auth": "Needs sign-in",
  failed: "Failed",
  disabled: "Disabled",
};

function capitalize(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayName(name: string): string {
  if (!name.startsWith("plugin:")) {
    return name;
  }
  const parts = name.split(":");

  return parts.length >= 3 ? parts.slice(2).join(":") : name;
}

/** Where the config came from, as the user would name it. */
export function mcpOrigin(
  name: string,
  source: string | null | undefined,
): string | null {
  if (name.startsWith("plugin:")) {
    const parts = name.split(":");

    return parts.length === 3 ? `${parts[1]} plugin` : "Plugin";
  }
  switch (source) {
    case "claudeai":
      return "claude.ai connector";
    case "user":
      return "User config";
    case "project":
      return "Project .mcp.json";
    case "local":
      return "Local config";
    case "dynamic":
      return "Argus";
    case null:
    case undefined:
      return null;
    default:
      return capitalize(source);
  }
}

export function mcpServerView(server: RemoteMcpServerStatus): McpServerView {
  const state = KNOWN.find((s) => s === server.status) ?? "other";
  const tools =
    server.tool_count == null
      ? null
      : `${server.tool_count} tool${server.tool_count === 1 ? "" : "s"}`;
  const parts = [mcpOrigin(server.name, server.source), tools].filter(
    (p): p is string => p !== null,
  );
  let detail = parts.length > 0 ? parts.join(" · ") : null;
  if (state === "failed" && server.error) {
    detail = server.error;
  }

  return {
    name: server.name,
    displayName: displayName(server.name),
    state,
    stateLabel: state === "other" ? capitalize(server.status) : LABELS[state],
    detail,
  };
}

/** What needs you first (failed, then sign-ins), then by name. */
export function mcpServerViews(
  servers: RemoteMcpServerStatus[],
): McpServerView[] {
  return servers.map(mcpServerView).sort((a, b) =>
    RANK[a.state] !== RANK[b.state]
      ? RANK[a.state] - RANK[b.state]
      : a.displayName.localeCompare(b.displayName, undefined, {
          numeric: true,
        }),
  );
}

/** Servers that won't work until someone acts. */
export function mcpProblemCount(views: McpServerView[]): number {
  return views.filter((v) => v.state === "failed" || v.state === "needs-auth")
    .length;
}
