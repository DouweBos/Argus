/**
 * Live MCP sessions and the CLI process that opened each. A CLI that is killed
 * (a discarded warm spare, a stopped agent) never sends the closing DELETE, so
 * its process exit closes its sessions instead — each one holds a whole
 * `McpServer` with every tool registered.
 */

import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/** Request header naming the spawn a CLI's MCP traffic comes from. */
export const SPAWN_ID_HEADER = "x-argus-spawn-id";

interface McpSession {
  transport: StreamableHTTPServerTransport;
  spawnId: string | null;
}

const sessions = new Map<string, McpSession>();

export function getMcpSession(
  sessionId: string,
): StreamableHTTPServerTransport | undefined {
  return sessions.get(sessionId)?.transport;
}

export function hasMcpSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function addMcpSession(
  sessionId: string,
  transport: StreamableHTTPServerTransport,
  spawnId: string | null,
): void {
  sessions.set(sessionId, { transport, spawnId });
}

export function removeMcpSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function mcpSessionCount(): number {
  return sessions.size;
}

/** The spawn's CLI exited: close every session it opened. */
export function closeMcpSessionsForSpawn(spawnId: string): void {
  for (const [sessionId, session] of [...sessions]) {
    if (session.spawnId === spawnId) {
      close(sessionId, session);
    }
  }
}

export function closeAllMcpSessions(): void {
  for (const [sessionId, session] of [...sessions]) {
    close(sessionId, session);
  }
}

function close(sessionId: string, session: McpSession): void {
  sessions.delete(sessionId);
  session.transport.close().catch(() => undefined);
}
