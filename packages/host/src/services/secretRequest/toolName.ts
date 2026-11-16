/** A dependency-free leaf: notifications and the gateway both need it. */

export const SECRET_TOOL = "request_secret";

/** `request_secret` under whatever prefix the runner gives MCP tools. */
export function isSecretRequestTool(name: string | undefined): boolean {
  return name === SECRET_TOOL || (!!name && name.endsWith(`__${SECRET_TOOL}`));
}
