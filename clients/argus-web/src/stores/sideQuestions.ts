/**
 * Side questions: ask a busy agent something without derailing it. The host
 * answers from a read-only fork of the agent's context; nothing lands in its
 * chat unless the user sends an exchange on. Kept in memory for the page's life.
 */

import { create } from "zustand";
import { request } from "../lib/request";
import { useAgentsStore } from "./agents";
import { currentTransport } from "./connection";
import { useTranscriptsStore } from "./transcripts";

export interface SideQuestionExchange {
  id: string;
  question: string;
  answer?: string;
  error?: string;
  pending: boolean;
  /** Sent on into the agent's main thread. */
  sent?: boolean;
}

interface SideQuestionsState {
  exchangesByAgent: Record<string, SideQuestionExchange[]>;
  ask: (agentId: string, question: string) => Promise<void>;
  /** Send an answered exchange into the agent's chat as a normal message. */
  sendToAgent: (agentId: string, exchangeId: string) => Promise<void>;
  clear: (agentId: string) => void;
}

// The host gives a forked query up to three minutes; outwait it so its own error wins.
export const SIDE_QUESTION_TIMEOUT_MS = 190_000;

export function sideQuestionMessage(question: string, answer: string): string {
  return `I asked a side question while you were working.\n\nQuestion: ${question}\n\nAnswer: ${answer}`;
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "The side question failed.";
}

let nextId = 0;

export const useSideQuestionsStore = create<SideQuestionsState>()(
  (set, get) => {
    const patch = (
      agentId: string,
      id: string,
      change: Partial<SideQuestionExchange>,
    ) =>
      set((s) => ({
        exchangesByAgent: {
          ...s.exchangesByAgent,
          [agentId]: (s.exchangesByAgent[agentId] ?? []).map((e) =>
            e.id === id ? { ...e, ...change } : e,
          ),
        },
      }));

    return {
      exchangesByAgent: {},

      ask: async (agentId, raw) => {
        const question = raw.trim();
        if (!question) {
          return;
        }
        const id = `side-${Date.now()}-${nextId++}`;
        set((s) => ({
          exchangesByAgent: {
            ...s.exchangesByAgent,
            [agentId]: [
              ...(s.exchangesByAgent[agentId] ?? []),
              { id, question, pending: true },
            ],
          },
        }));
        try {
          const t = currentTransport();
          if (!t) {
            throw new Error("Not connected to the computer.");
          }
          const { answer } = await request(
            t,
            "agents.ask_side",
            { agent_id: agentId, question },
            { timeoutMs: SIDE_QUESTION_TIMEOUT_MS },
          );
          patch(agentId, id, { answer, pending: false });
        } catch (error) {
          patch(agentId, id, { error: errorText(error), pending: false });
        }
      },

      sendToAgent: async (agentId, exchangeId) => {
        const exchange = get().exchangesByAgent[agentId]?.find(
          (e) => e.id === exchangeId,
        );
        if (!exchange?.answer || exchange.sent) {
          return;
        }
        const message = sideQuestionMessage(exchange.question, exchange.answer);
        patch(agentId, exchangeId, { sent: true });
        // Same path as the composer: a busy agent gets it queued behind its turn.
        const running =
          useAgentsStore.getState().statusByAgent[agentId]?.status === "running";
        try {
          if (running) {
            await useAgentsStore
              .getState()
              .queueMessage(agentId, message, undefined, message);
          } else {
            await useTranscriptsStore.getState().sendMessage(agentId, message);
          }
        } catch (error) {
          patch(agentId, exchangeId, { sent: false });
          throw error;
        }
      },

      clear: (agentId) =>
        set((s) => {
          const rest = { ...s.exchangesByAgent };
          delete rest[agentId];

          return { exchangesByAgent: rest };
        }),
    };
  },
);

export function resetSideQuestions(): void {
  useSideQuestionsStore.setState({ exchangesByAgent: {} });
}
