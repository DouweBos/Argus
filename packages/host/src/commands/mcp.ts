import { defineTypedCommand } from "../services/command/registry";
import { testMcpServer } from "../services/mcp/connectivity";
import { cancelAuthentication, signOut } from "../services/mcp/oauth";
import { mcpOAuthStatus, signInToMcpServer } from "../services/mcp/oauthStatus";
import { listAuthorized } from "../services/mcp/oauthStore";
import { listInheritedMcpServers } from "../services/mcp/userConfig";

export function registerMcpCommands(): void {
  defineTypedCommand("list_inherited_mcp_servers", (p) =>
    listInheritedMcpServers(p.worktreePath ?? null),
  );
  defineTypedCommand("test_mcp_server", (p) => testMcpServer(p.config));
  defineTypedCommand("mcp_oauth_sign_in", (p) =>
    signInToMcpServer(p.serverUrl, p.resourceMetadataUrl ?? null),
  );
  defineTypedCommand("mcp_oauth_sign_out", (p) => signOut(p.serverUrl));
  defineTypedCommand("mcp_oauth_cancel_sign_in", (p) =>
    cancelAuthentication(p.serverUrl),
  );
  defineTypedCommand("mcp_oauth_status", (p) => mcpOAuthStatus(p.serverUrl));
  defineTypedCommand("mcp_oauth_list_authorized", () => listAuthorized());
}
