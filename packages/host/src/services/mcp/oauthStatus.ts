import { authenticate } from "./oauth";
import { loadToken, type StoredMcpToken } from "./oauthStore";

/** What the UI learns about a stored token — never the token itself. */
export interface McpOAuthStatus {
  resource: string;
  hasRefreshToken: boolean;
  expiresAt: number | null;
  scope: string | null;
}

function tokenStatus(t: StoredMcpToken): McpOAuthStatus {
  return {
    resource: t.resource,
    hasRefreshToken: Boolean(t.refreshToken),
    expiresAt: t.expiresAt ?? null,
    scope: t.scope ?? null,
  };
}

export async function signInToMcpServer(
  serverUrl: string,
  resourceMetadataUrl: string | null,
): Promise<McpOAuthStatus> {
  return tokenStatus(await authenticate({ serverUrl, resourceMetadataUrl }));
}

export async function mcpOAuthStatus(
  serverUrl: string,
): Promise<McpOAuthStatus | null> {
  const t = await loadToken(serverUrl);

  return t ? tokenStatus(t) : null;
}
