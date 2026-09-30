import { z } from "zod";
import {
  InheritedMcpServer,
  McpOAuthStatus,
  McpTestResult,
} from "../models/mcp";
import { type CommandSpec, NoParams, Void } from "./spec";

const ServerUrl = z.object({ serverUrl: z.string() });

export const MCP_COMMANDS = {
  /** Omit the worktree for the global view (no project-scoped sources). */
  list_inherited_mcp_servers: {
    tier: "admin",
    params: z.object({ worktreePath: z.string().nullish() }),
    result: z.array(InheritedMcpServer),
  },
  /** `config` is one `mcpServers[name]` value; the probe validates it. */
  test_mcp_server: {
    tier: "admin",
    params: z.object({ config: z.record(z.string(), z.unknown()) }),
    result: McpTestResult,
  },
  mcp_oauth_sign_in: {
    tier: "admin",
    params: ServerUrl.extend({ resourceMetadataUrl: z.string().nullish() }),
    result: McpOAuthStatus,
  },
  mcp_oauth_sign_out: { tier: "admin", params: ServerUrl, result: Void },
  /** False when no sign-in was in flight for that server. */
  mcp_oauth_cancel_sign_in: {
    tier: "admin",
    params: ServerUrl,
    result: z.boolean(),
  },
  mcp_oauth_status: {
    tier: "admin",
    params: ServerUrl,
    result: McpOAuthStatus.nullable(),
  },
  mcp_oauth_list_authorized: {
    tier: "admin",
    params: NoParams,
    result: z.array(z.string()),
  },
} as const satisfies Record<string, CommandSpec>;
