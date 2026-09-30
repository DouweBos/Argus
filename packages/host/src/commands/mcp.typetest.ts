import type { Equal, Expect } from "./typeEquality";
import type {
  McpTestResult as HostMcpTestResult,
  McpTool as HostMcpTool,
} from "../services/mcp/connectivity";
import type { McpOAuthStatus as HostMcpOAuthStatus } from "../services/mcp/oauthStatus";
import type { InheritedMcpServer as HostInheritedMcpServer } from "../services/mcp/userConfig";
import type {
  InheritedMcpServer,
  McpOAuthStatus,
  McpTestResult,
  McpTool,
} from "@argus/remote-protocol";

export type McpModelChecks = [
  Expect<Equal<InheritedMcpServer, HostInheritedMcpServer>>,
  Expect<Equal<McpTool, HostMcpTool>>,
  Expect<Equal<McpTestResult, HostMcpTestResult>>,
  Expect<Equal<McpOAuthStatus, HostMcpOAuthStatus>>,
];
