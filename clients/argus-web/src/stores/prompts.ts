/**
 * Permission prompts waiting on someone, and answers given from a
 * notification while offline. Mirrors ArgusCore's `PendingPrompts`.
 */

import { create } from "zustand";
import type { Transport } from "@argus/remote-client";
import {
  clearPendingDecision,
  queuePendingDecision,
  readPendingDecisions,
  type PendingDecision,
} from "../lib/pendingDecisions";
import type { RemotePermissionRequest } from "../lib/protocol";
import { request } from "../lib/request";
import { currentTransport, readyTransport } from "./connection";
import { scheduleTranscript, useTranscriptsStore } from "./transcripts";

export function promptKey(agentId: string, toolUseId: string): string {
  return `${agentId}:${toolUseId}`;
}

interface PromptsState {
  prompts: Record<string, RemotePermissionRequest>;
  /** Prompts this client just answered (`${agentId}:${toolUseId}`): clears the
   *  inline form at once, before the resolved page round-trips back. */
  answered: Record<string, true>;

  respond: (
    agentId: string,
    toolUseId: string,
    decision: "allow" | "deny",
    message?: string,
  ) => Promise<void>;
  /** Answer a prompt from a notification button, even while offline. */
  decidePrompt: (
    agentId: string,
    toolUseId: string,
    decision: "allow" | "deny",
  ) => Promise<void>;
}

const EMPTY = { prompts: {}, answered: {} } satisfies Partial<PromptsState>;

export const usePromptsStore = create<PromptsState>()((set) => ({
  ...EMPTY,

  respond: async (agentId, toolUseId, decision, message) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    await request(t, "permission.respond", {
      agent_id: agentId,
      tool_use_id: toolUseId,
      decision,
      ...(message ? { message } : {}),
    });
    set((s) => {
      const key = promptKey(agentId, toolUseId);
      const prompts = { ...s.prompts };
      delete prompts[key];

      return { prompts, answered: { ...s.answered, [key]: true } };
    });
    // Pull the resolved transcript so the answered prompt clears and any
    // follow-up (the next question) shows without waiting on events.
    useTranscriptsStore
      .getState()
      .loadTranscript(agentId)
      .catch(() => {});
  },

  decidePrompt: async (agentId, toolUseId, decision) => {
    queuePendingDecision({ agentId, toolUseId, decision, at: Date.now() });
    const transport = readyTransport();
    if (transport) {
      await flushPendingDecisions(transport).catch(() => {});
    }
  },
}));

/**
 * Replay a queued Approve/Deny. The gateway only accepts answers to prompts
 * it forwarded to *this* connection, and it re-forwards pending ones when we
 * subscribe — so subscribe first, then retry while the replay lands.
 */
async function flushDecision(
  transport: Transport,
  decision: PendingDecision,
): Promise<boolean> {
  transport.subscribe(decision.agentId, true);
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await request(transport, "permission.respond", {
          agent_id: decision.agentId,
          tool_use_id: decision.toolUseId,
          decision: decision.decision,
        });

        return true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }

    return false;
  } finally {
    transport.subscribe(decision.agentId, false);
  }
}

export async function flushPendingDecisions(
  transport: Transport,
): Promise<void> {
  for (const decision of readPendingDecisions(Date.now())) {
    const sent = await flushDecision(transport, decision);
    // Drop it either way: a prompt that never came back is gone for good.
    clearPendingDecision(decision);
    if (sent) {
      scheduleTranscript(decision.agentId);
    }
  }
}

/** `permission.request`: a tool call is waiting on someone. */
export function receivePrompt(prompt: RemotePermissionRequest): void {
  usePromptsStore.setState((s) => ({
    prompts: {
      ...s.prompts,
      [promptKey(prompt.agent_id, prompt.tool_use_id)]: prompt,
    },
  }));
}

/** `permission.cancel`: answered elsewhere, or the turn moved on. */
export function cancelPrompt(agentId: string, toolUseId: string): void {
  usePromptsStore.setState((s) => {
    const prompts = { ...s.prompts };
    delete prompts[promptKey(agentId, toolUseId)];

    return { prompts };
  });
}

export function resetPrompts(): void {
  usePromptsStore.setState(EMPTY);
}
