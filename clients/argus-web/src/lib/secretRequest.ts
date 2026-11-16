/** An agent's `request_secret` call, as its card shows it. Mirrors ArgusKit's `SecretRequest`. */

export interface SecretRequest {
  label: string;
  reason: string;
  destination: string;
}

/** `request_secret` under whatever prefix the runner gives MCP tools. */
export function isSecretRequestTool(name: string): boolean {
  return name === "request_secret" || name.endsWith("__request_secret");
}

export function parseSecretRequest(
  name: string,
  input: Record<string, unknown>,
): SecretRequest | null {
  if (!isSecretRequestTool(name) || typeof input.label !== "string") {
    return null;
  }
  const reason = typeof input.reason === "string" ? input.reason : "";
  const env =
    input.delivery === "env" &&
    typeof input.run_command === "string" &&
    typeof input.env_var === "string";

  return {
    label: input.label,
    reason,
    destination: env
      ? `Set as ${String(input.env_var)} for the “${String(input.run_command)}” run command, kept in memory only.`
      : "Saved to a private file on your computer for the agent to read, deleted within 24 hours.",
  };
}
