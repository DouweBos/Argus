/**
 * The computer's teammates: who they are, their duties, memory and
 * conversations. Mirrors ArgusCore's `TeammatesStore` over the gateway.
 * Reads are `monitor`; anything that saves, opens a conversation or moves a
 * duty needs `control`.
 */

import type {
  OpenedTeammateThread,
  RemoteAutomationMemory,
  RemoteTeammateTemplate,
  Teammate,
  TeammateClearableField,
  TeammateSummary,
  TeammateThread,
  UpdateTeammateInput,
} from "@argus/remote-protocol";
import { create } from "zustand";
import {
  describeError,
  INITIAL_LOAD,
  isQuietError,
  type LoadState,
} from "@argus/client-core";
import type { ResultOf } from "../lib/protocol";
import { request } from "../lib/request";
import { capture } from "../telemetry/telemetry";
import { useAutomationsStore } from "./automations";
import { currentTransport } from "./connection";
import type { RefreshOptions } from "./projects";

export type TeammateDetail = ResultOf<"teammates.get">;

type MemoryInput = Omit<RemoteAutomationMemory, "updated_at"> & {
  previous_name: string | null;
};

interface TeammatesState {
  summaries: TeammateSummary[];
  load: LoadState;
  detailById: Record<string, TeammateDetail>;
  memoriesById: Record<string, RemoteAutomationMemory[]>;
  threadsById: Record<string, TeammateThread[]>;
  /** The conversation last opened per teammate, whose agent the composer talks to. */
  openedById: Record<string, OpenedTeammateThread>;
  /** Null until the gallery asks. */
  templates: RemoteTeammateTemplate[] | null;
  /** A failed action, for the screen's banner. */
  error: string | null;

  refresh: (options?: RefreshOptions) => Promise<void>;
  loadDetail: (id: string) => Promise<TeammateDetail | null>;
  loadTemplates: () => Promise<void>;
  loadMemories: (id: string) => Promise<void>;
  loadThreads: (id: string) => Promise<void>;
  /** No `threadId`: the newest, or a new one with `fresh`. Throws the computer's reason. */
  openThread: (
    teammateId: string,
    threadId: string | null,
    fresh?: boolean,
  ) => Promise<OpenedTeammateThread>;
  /** Pick a stopped conversation back up with a continue. Throws the computer's reason. */
  resumeThread: (teammateId: string, threadId: string) => Promise<void>;
  archiveThread: (teammateId: string, threadId: string) => Promise<boolean>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** `clear` sets fields back to inheriting. Throws the computer's reason. */
  update: (
    id: string,
    patch: UpdateTeammateInput,
    clear?: TeammateClearableField[],
  ) => Promise<void>;
  /** A rewritten soul for the editor; nothing is saved. Throws the computer's reason. */
  reviseSoul: (name: string, soul: string, instruction: string) => Promise<string>;
  saveSoul: (id: string, soul: string) => Promise<void>;
  remove: (id: string, keepDuties: boolean) => Promise<boolean>;
  createFromTemplate: (
    templateId: string,
    repoRoots: string[],
  ) => Promise<Teammate | null>;
  /** Null `teammateId` makes a new teammate named after the automation. */
  promote: (
    automationId: string,
    teammateId: string | null,
  ) => Promise<Teammate | null>;
  removeDuty: (teammateId: string, automationId: string) => Promise<void>;
  saveMemory: (teammateId: string, memory: MemoryInput) => Promise<void>;
  deleteMemory: (teammateId: string, name: string) => Promise<void>;
  clearError: () => void;
}

const EMPTY = {
  summaries: [],
  load: INITIAL_LOAD,
  detailById: {},
  memoriesById: {},
  threadsById: {},
  openedById: {},
  templates: null,
  error: null,
} satisfies Partial<TeammatesState>;

function transport() {
  const t = currentTransport();
  if (!t) {
    throw new Error("Not connected to a computer.");
  }

  return t;
}

export const useTeammatesStore = create<TeammatesState>()((set, get) => {
  function fail(summary: string, err: unknown): void {
    set({ error: `${summary} — ${describeError(err)}` });
  }

  function upsert(teammate: Teammate): void {
    set((s) => ({
      summaries: s.summaries.some((t) => t.teammate.id === teammate.id)
        ? s.summaries.map((t) =>
            t.teammate.id === teammate.id ? { ...t, teammate } : t,
          )
        : s.summaries,
      detailById: s.detailById[teammate.id]
        ? {
            ...s.detailById,
            [teammate.id]: { ...s.detailById[teammate.id], teammate },
          }
        : s.detailById,
    }));
  }

  const background = () =>
    void get()
      .refresh({ background: true })
      .catch(() => {});

  return {
    ...EMPTY,

    refresh: async (options) => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      try {
        const { teammates } = await request(t, "teammates.list", {});
        set({ summaries: teammates, load: { loaded: true, error: null } });
      } catch (err) {
        if (!isQuietError(err, options?.background ?? false)) {
          set({ load: { loaded: true, error: describeError(err) } });
        }
        throw err;
      }
    },

    loadDetail: async (id) => {
      const t = currentTransport();
      if (!t) {
        return null;
      }
      const detail = await request(t, "teammates.get", { teammate_id: id });
      set((s) => ({ detailById: { ...s.detailById, [id]: detail } }));

      return detail;
    },

    loadTemplates: async () => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      const { templates } = await request(t, "teammates.templates", {});
      set({ templates });
    },

    loadMemories: async (id) => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      const { memories } = await request(t, "teammates.memories", {
        teammate_id: id,
      });
      set((s) => ({ memoriesById: { ...s.memoriesById, [id]: memories } }));
    },

    loadThreads: async (id) => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      const { threads } = await request(t, "teammates.threads", {
        teammate_id: id,
      });
      set((s) => ({ threadsById: { ...s.threadsById, [id]: threads } }));
    },

    openThread: async (teammateId, threadId, fresh) => {
      const opened = await request(transport(), "teammates.open_thread", {
        teammate_id: teammateId,
        thread_id: threadId,
        fresh,
      });
      set((s) => ({ openedById: { ...s.openedById, [teammateId]: opened } }));
      void get()
        .loadThreads(teammateId)
        .catch(() => {});

      return opened;
    },

    resumeThread: async (teammateId, threadId) => {
      const opened = await request(transport(), "teammates.resume_thread", {
        thread_id: threadId,
      });
      set((s) => ({ openedById: { ...s.openedById, [teammateId]: opened } }));
      await get().loadThreads(teammateId);
    },

    archiveThread: async (teammateId, threadId) => {
      try {
        await request(transport(), "teammates.archive_thread", {
          thread_id: threadId,
        });
        capture("web_teammate_edited", { action: "archive_thread" });
        set((s) => ({
          threadsById: {
            ...s.threadsById,
            [teammateId]: (s.threadsById[teammateId] ?? []).filter(
              (t) => t.id !== threadId,
            ),
          },
        }));

        return true;
      } catch (err) {
        fail("Couldn't archive that conversation", err);

        return false;
      }
    },

    setEnabled: async (id, enabled) => {
      try {
        const { teammate } = await request(transport(), "teammates.update", {
          teammate_id: id,
          patch: { enabled },
        });
        capture("web_teammate_edited", {
          action: enabled ? "enable" : "disable",
        });
        upsert(teammate);
      } catch (err) {
        fail(enabled ? "Couldn't turn it on" : "Couldn't pause it", err);
      }
    },

    update: async (id, patch, clear) => {
      const { teammate } = await request(transport(), "teammates.update", {
        teammate_id: id,
        patch,
        ...(clear && clear.length > 0 && { clear }),
      });
      capture("web_teammate_edited", { action: "save" });
      upsert(teammate);
    },

    reviseSoul: async (name, soul, instruction) => {
      const result = await request(transport(), "teammates.revise_soul", {
        name,
        soul,
        instruction,
      });

      return result.soul;
    },

    saveSoul: async (id, soul) => {
      await request(transport(), "teammates.save_soul", {
        teammate_id: id,
        soul,
      });
      set((s) =>
        s.detailById[id]
          ? { detailById: { ...s.detailById, [id]: { ...s.detailById[id], soul } } }
          : {},
      );
    },

    remove: async (id, keepDuties) => {
      try {
        await request(transport(), "teammates.delete", {
          teammate_id: id,
          keep_duties: keepDuties,
        });
        set((s) => ({
          summaries: s.summaries.filter((t) => t.teammate.id !== id),
        }));
        void useAutomationsStore
          .getState()
          .refresh({ background: true })
          .catch(() => {});

        return true;
      } catch (err) {
        fail("Couldn't delete that teammate", err);

        return false;
      }
    },

    createFromTemplate: async (templateId, repoRoots) => {
      try {
        const { teammate } = await request(
          transport(),
          "teammates.create_from_template",
          { template_id: templateId, repo_roots: repoRoots },
        );
        background();

        return teammate;
      } catch (err) {
        fail("Couldn't add that teammate", err);

        return null;
      }
    },

    promote: async (automationId, teammateId) => {
      try {
        const { teammate } = await request(transport(), "teammates.promote", {
          automation_id: automationId,
          teammate_id: teammateId,
        });
        capture("web_teammate_edited", { action: "add_duty" });
        background();
        await Promise.allSettled([
          get().loadDetail(teammate.id),
          useAutomationsStore.getState().refresh({ background: true }),
        ]);

        return teammate;
      } catch (err) {
        fail("Couldn't move that automation", err);

        return null;
      }
    },

    removeDuty: async (teammateId, automationId) => {
      try {
        await request(transport(), "teammates.remove_duty", {
          automation_id: automationId,
        });
        capture("web_teammate_edited", { action: "remove_duty" });
        set((s) =>
          s.detailById[teammateId]
            ? {
                detailById: {
                  ...s.detailById,
                  [teammateId]: {
                    ...s.detailById[teammateId],
                    duties: s.detailById[teammateId].duties.filter(
                      (d) => d.id !== automationId,
                    ),
                  },
                },
              }
            : {},
        );
        background();
        void useAutomationsStore
          .getState()
          .refresh({ background: true })
          .catch(() => {});
      } catch (err) {
        fail("Couldn't remove that duty", err);
      }
    },

    saveMemory: async (teammateId, memory) => {
      await request(transport(), "teammates.save_memory", {
        teammate_id: teammateId,
        memory,
      });
      capture("web_memory_edited", { action: "save" });
      await get()
        .loadMemories(teammateId)
        .catch(() => {});
    },

    deleteMemory: async (teammateId, name) => {
      try {
        await request(transport(), "teammates.delete_memory", {
          teammate_id: teammateId,
          name,
        });
        capture("web_memory_edited", { action: "delete" });
        set((s) => ({
          memoriesById: {
            ...s.memoriesById,
            [teammateId]: (s.memoriesById[teammateId] ?? []).filter(
              (m) => m.name !== name,
            ),
          },
        }));
      } catch (err) {
        fail("Couldn't delete that memory", err);
      }
    },

    clearError: () => set({ error: null }),
  };
});

export function resetTeammates(): void {
  useTeammatesStore.setState(EMPTY);
}
