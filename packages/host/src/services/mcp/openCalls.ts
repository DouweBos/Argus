/** Which agents have an Argus MCP call under way; a dead CLI can't take the answer. */

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { RequestId } from "@modelcontextprotocol/sdk/types.js";

type Probe = () => boolean;

const probes = new Map<string, Set<Probe>>();

/** Count `probe` towards the agent's open calls until the returned undo runs. */
function trackOpenWork(agentId: string, probe: Probe): () => void {
  let set = probes.get(agentId);
  if (!set) {
    set = new Set();
    probes.set(agentId, set);
  }
  set.add(probe);

  return () => {
    const current = probes.get(agentId);
    current?.delete(probe);
    if (current?.size === 0) {
      probes.delete(agentId);
    }
  };
}

export function hasOpenMcpCall(agentId: string): boolean {
  return [...(probes.get(agentId) ?? [])].some((probe) => probe());
}

/**
 * Follow a connected transport until it closes: each request until it's
 * answered or cancelled, and any task still running, polled or not.
 */
export function trackOpenCalls(
  agentId: string,
  transport: Transport,
  hasRunningTask: () => boolean = () => false,
): void {
  const open = new Set<RequestId>();
  const untrack = trackOpenWork(
    agentId,
    () => open.size > 0 || hasRunningTask(),
  );

  const receive = transport.onmessage;
  transport.onmessage = (message, extra) => {
    if ("method" in message) {
      if ("id" in message) {
        open.add(message.id);
      } else if (message.method === "notifications/cancelled") {
        const id = message.params?.requestId as RequestId | undefined;
        if (id !== undefined) {
          open.delete(id);
        }
      }
    }
    receive?.(message, extra);
  };

  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    if (!("method" in message) && message.id !== undefined) {
      open.delete(message.id);
    }

    return send(message, options);
  };

  const closed = transport.onclose;
  transport.onclose = () => {
    untrack();
    closed?.();
  };
}
