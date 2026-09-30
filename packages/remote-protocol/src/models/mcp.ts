import { z } from "zod";

/** An MCP server Argus inherits from Claude Code's own config. */
export const InheritedMcpServer = z.object({
  /** Server name (the key inside `mcpServers`). */
  name: z.string(),
  /** Server config — opaque object passed straight through to Claude Code. */
  config: z.record(z.string(), z.unknown()),
  /** Where the entry came from (e.g. `"plugin:plex-tools"`, `".mcp.json"`). */
  source: z.string(),
});
export type InheritedMcpServer = z.infer<typeof InheritedMcpServer>;

export const McpTool = z.object({
  name: z.string(),
  description: z.string().optional(),
});
export type McpTool = z.infer<typeof McpTool>;

/** Result of a connectivity probe against an MCP server. */
export const McpTestResult = z.object({
  ok: z.boolean(),
  transport: z.enum(["http", "stdio", "unknown"]),
  latencyMs: z.number().optional(),
  protocolVersion: z.string().optional(),
  serverInfo: z
    .object({ name: z.string().optional(), version: z.string().optional() })
    .optional(),
  /** Tools advertised by the server (HTTP transport only, best-effort). */
  tools: z.array(McpTool).optional(),
  error: z.string().optional(),
  /** HTTP status code, when the failure came from the transport layer. */
  status: z.number().optional(),
  /** Raw `WWW-Authenticate` header from a 401/403, if any. */
  wwwAuthenticate: z.string().optional(),
  /** OAuth protected-resource metadata URL parsed from `WWW-Authenticate`. */
  resourceMetadataUrl: z.string().optional(),
  /** Truncated response body for diagnosis (max ~500 chars). */
  bodySnippet: z.string().optional(),
  /** Short, human-friendly next-step suggestion. */
  hint: z.string().optional(),
});
export type McpTestResult = z.infer<typeof McpTestResult>;

/** OAuth status for a single MCP server — never the token itself. */
export const McpOAuthStatus = z.object({
  resource: z.string(),
  hasRefreshToken: z.boolean(),
  /** Epoch ms when the access token stops being valid. */
  expiresAt: z.number().nullable(),
  scope: z.string().nullable(),
});
export type McpOAuthStatus = z.infer<typeof McpOAuthStatus>;
