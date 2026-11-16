/**
 * Open secret requests. One rides the permission-prompt plumbing — the card,
 * the push, the replay to a reconnecting phone — but is answered with a value
 * through `answerSecretRequest`, which never touches a transcript or an event.
 */

import { addHostEventSink, emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";
import { SECRET_TOOL } from "./toolName";
import { forgetSessionSecrets } from "./vault";

export type SecretAnswer =
  | { kind: "cancelled" }
  | { kind: "declined" }
  | { kind: "provided"; value: string };

interface Pending {
  settle: (answer: SecretAnswer) => void;
}

const pending = new Map<string, Pending>();

function key(agentId: string, toolUseId: string): string {
  return `${agentId}::${toolUseId}`;
}

let unsubscribe: (() => void) | null = null;

/** A stopped agent can't take its secret any more, nor a deleted session's runs. */
function watchExits(): void {
  if (unsubscribe) {
    return;
  }
  unsubscribe = addHostEventSink((channel, args) => {
    const match = /^agent:exit:(.+)$/.exec(channel);
    if (match) {
      cancelSecretRequestsFor(match[1]!);
    } else if (channel === "session:deleted" && typeof args[0] === "string") {
      forgetSessionSecrets(args[0]);
    }
  });
}

export function isPendingSecretRequest(
  agentId: string,
  toolUseId: string,
): boolean {
  return pending.has(key(agentId, toolUseId));
}

export interface OpenSecretRequest {
  agentId: string;
  toolUseId: string;
  toolName?: string;
  /** What the card shows: the label, the reason and the delivery. Never a value. */
  input: Record<string, unknown>;
  signal?: AbortSignal;
}

export function openSecretRequest(
  req: OpenSecretRequest,
): Promise<SecretAnswer> {
  watchExits();
  const k = key(req.agentId, req.toolUseId);
  if (pending.has(k)) {
    return Promise.reject("This secret request is already open");
  }

  return new Promise<SecretAnswer>((resolve) => {
    const settle = (answer: SecretAnswer) => {
      if (!pending.delete(k)) {
        return;
      }
      req.signal?.removeEventListener("abort", onAbort);
      appState.agentPendingPermissions.get(req.agentId)?.delete(req.toolUseId);
      emitHostEvent(
        `agent:${answer.kind === "cancelled" ? "permission-cancel" : "permission-resolved"}:${req.agentId}`,
        {
          tool_use_id: req.toolUseId,
          request_id: `secret:${req.toolUseId}`,
          decision: answer.kind === "provided" ? "allow" : "deny",
        },
      );
      resolve(answer);
    };
    const onAbort = () => settle({ kind: "cancelled" });
    pending.set(k, { settle });
    req.signal?.addEventListener("abort", onAbort, { once: true });

    const payload = {
      request_id: `secret:${req.toolUseId}`,
      tool_name: req.toolName ?? `mcp__argus__${SECRET_TOOL}`,
      tool_input: req.input,
      tool_use_id: req.toolUseId,
    };
    let forAgent = appState.agentPendingPermissions.get(req.agentId);
    if (!forAgent) {
      forAgent = new Map();
      appState.agentPendingPermissions.set(req.agentId, forAgent);
    }
    forAgent.set(req.toolUseId, payload);
    emitHostEvent(`agent:permission:${req.agentId}`, payload);
    if (req.signal?.aborted) {
      onAbort();
    }
  });
}

/** `value` null declines. Throws when nothing is waiting there. */
export function answerSecretRequest(
  agentId: string,
  toolUseId: string,
  value: string | null,
): void {
  const entry = pending.get(key(agentId, toolUseId));
  if (!entry) {
    throw "no such outstanding prompt";
  }
  entry.settle(
    value === null ? { kind: "declined" } : { kind: "provided", value },
  );
}

export function cancelSecretRequestsFor(agentId: string): void {
  const prefix = `${agentId}::`;
  for (const [k, entry] of [...pending]) {
    if (k.startsWith(prefix)) {
      entry.settle({ kind: "cancelled" });
    }
  }
}

export function resetSecretRequestsForTests(): void {
  for (const entry of [...pending.values()]) {
    entry.settle({ kind: "cancelled" });
  }
  unsubscribe?.();
  unsubscribe = null;
}
