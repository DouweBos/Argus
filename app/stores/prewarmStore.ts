import type { ModelOption } from "../components/agent/ModelPicker";
import type { AgentCapabilities, SlashCommand } from "../lib/types";
import { create } from "zustand";

/**
 * One eagerly-spawned Claude subprocess per session, kept ready so the
 * Start-agent dialog has real capabilities up front and the user-facing
 * "send" path can skip the 1–3s spawn + initialize handshake.
 *
 * Lifecycle is driven by `prewarmService` — sessions in `ready` state get
 * a slot, sessions that are deleted or whose slot is claimed get the slot
 * cleared. The store itself is dumb state.
 */

export type PrewarmStatus = "failed" | "ready" | "spawning";

export interface PrewarmSlot {
  agentId: string | null;
  capabilities: AgentCapabilities | null;
  /** Models normalised to ModelPicker's shape so the dialog can render directly. */
  models: ModelOption[];
  slashCommands: SlashCommand[];
  status: PrewarmStatus;
}

interface PrewarmState {
  /** sessionId -> slot. */
  slots: Record<string, PrewarmSlot>;
}

const store = create<PrewarmState>(() => ({ slots: {} }));

const EMPTY_SLOT: PrewarmSlot = {
  agentId: null,
  capabilities: null,
  models: [],
  slashCommands: [],
  status: "spawning",
};

export function startPrewarming(sessionId: string) {
  store.setState((state) => ({
    slots: { ...state.slots, [sessionId]: { ...EMPTY_SLOT } },
  }));
}

export function setPrewarmReady(
  sessionId: string,
  payload: {
    agentId: string;
    capabilities: AgentCapabilities | null;
  },
) {
  store.setState((state) => {
    const models: ModelOption[] =
      payload.capabilities?.models?.map((m) => ({
        value: m.value,
        displayName: m.displayName,
        description: m.description,
      })) ?? [];
    const slashCommands: SlashCommand[] = payload.capabilities?.commands ?? [];

    return {
      slots: {
        ...state.slots,
        [sessionId]: {
          agentId: payload.agentId,
          capabilities: payload.capabilities,
          models,
          slashCommands,
          status: "ready",
        },
      },
    };
  });
}

export function setPrewarmFailed(sessionId: string) {
  store.setState((state) => {
    const existing = state.slots[sessionId];
    if (!existing) {
      return state;
    }

    return {
      slots: {
        ...state.slots,
        [sessionId]: { ...existing, status: "failed" },
      },
    };
  });
}

/** Clear a slot. Used after claim, after discard, or on session removal. */
export function clearPrewarm(sessionId: string) {
  store.setState((state) => {
    if (!(sessionId in state.slots)) {
      return state;
    }
    const { [sessionId]: _removed, ...rest } = state.slots;

    return { slots: rest };
  });
}

export const usePrewarmSlot = (sessionId: string | null | undefined) =>
  store((s) => (sessionId ? (s.slots[sessionId] ?? null) : null));

export const getPrewarmSlot = (sessionId: string): PrewarmSlot | null =>
  store.getState().slots[sessionId] ?? null;

export const getPrewarmState = () => store.getState();
