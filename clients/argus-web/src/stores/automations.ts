/**
 * The computer's automations, their runs, memories and each run's report.
 * Mirrors ArgusCore's `AutomationsStore` over the gateway's typed methods.
 * Reads are `monitor`; anything that saves, runs or spends needs `control`.
 */

import type {
  AutomationCalibration,
  RemoteAutomation,
  RemoteAutomationDetail,
  RemoteAutomationMemory,
  RemoteAutomationRun,
  RemoteRunner,
  RemoteSignalSource,
} from "@argus/remote-protocol";
import { create } from "zustand";
import {
  DEFAULT_GUARDRAILS,
  describeError,
  draftToInput,
  INITIAL_LOAD,
  isQuietError,
  localTimezone,
  type LoadState,
} from "@argus/client-core";
import type { ResultOf } from "../lib/protocol";
import { request } from "../lib/request";
import { capture } from "../telemetry/telemetry";
import { currentTransport } from "./connection";
import type { RefreshOptions } from "./projects";

export type RunDetail = ResultOf<"automations.run">;

const RUN_LIMIT = 40;

interface AutomationsState {
  automations: RemoteAutomation[];
  /** Newest first, across every automation and quick run. */
  runs: RemoteAutomationRun[];
  load: LoadState;
  /** Ad-hoc runs only; null until the Quick Run screen asks. */
  quickRuns: RemoteAutomationRun[] | null;
  detailById: Record<string, RemoteAutomationDetail>;
  memoriesById: Record<string, RemoteAutomationMemory[]>;
  calibrationById: Record<string, AutomationCalibration>;
  detailByRun: Record<string, RunDetail>;
  sources: RemoteSignalSource[];
  runners: RemoteRunner[];
  /** Run-now pressed and no run listed for it yet. */
  triggering: string[];
  /** A failed action, for the screen's banner. */
  error: string | null;

  refresh: (options?: RefreshOptions) => Promise<void>;
  loadDetail: (id: string) => Promise<RemoteAutomationDetail | null>;
  loadEditorOptions: () => Promise<void>;
  loadMemories: (id: string) => Promise<void>;
  loadCalibration: (id: string) => Promise<void>;
  loadRun: (runId: string) => Promise<void>;
  loadQuickRuns: () => Promise<void>;
  /** Create when `id` is null; returns the saved id. Throws the computer's reason. */
  save: (id: string | null, draft: RemoteAutomationDetail) => Promise<string>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<boolean>;
  revisePlaybook: (
    playbook: string,
    instruction: string,
    name: string,
  ) => Promise<string>;
  draft: (
    description: string,
    regenerating: boolean,
  ) => Promise<{ automation: RemoteAutomationDetail; notes: string[] }>;
  saveMemory: (
    automationId: string,
    memory: Omit<RemoteAutomationMemory, "updated_at"> & {
      previous_name: string | null;
    },
  ) => Promise<void>;
  deleteMemory: (automationId: string, name: string) => Promise<void>;
  runNow: (automationId: string) => Promise<void>;
  runScratch: (spec: {
    name: string;
    playbook: string;
    repo_roots: string[];
    model: string | null;
  }) => Promise<RemoteAutomationRun>;
  saveScratchRun: (runId: string, name: string) => Promise<string>;
  sendRunFeedback: (
    runId: string,
    note: string,
    allowClearing: boolean,
  ) => Promise<void>;
  cancelRun: (runId: string) => Promise<void>;
  deleteRun: (runId: string) => Promise<boolean>;
  /** Opening a report marks it read on the computer too. */
  markRunRead: (runId: string) => Promise<void>;
  /** Dismissing a failure from the inbox is reading it; no reason asked. */
  dismissRun: (runId: string) => Promise<void>;
  clearError: () => void;
}

const EMPTY = {
  automations: [],
  runs: [],
  load: INITIAL_LOAD,
  quickRuns: null,
  detailById: {},
  memoriesById: {},
  calibrationById: {},
  detailByRun: {},
  sources: [],
  runners: [],
  triggering: [],
  error: null,
} satisfies Partial<AutomationsState>;

function transport() {
  const t = currentTransport();
  if (!t) {
    throw new Error("Not connected to a computer.");
  }

  return t;
}

export const useAutomationsStore = create<AutomationsState>()((set, get) => {
  function fail(summary: string, err: unknown): void {
    set({ error: `${summary} — ${describeError(err)}` });
  }

  function upsertRun(run: RemoteAutomationRun): void {
    const merge = (list: RemoteAutomationRun[]) =>
      list.some((r) => r.id === run.id)
        ? list.map((r) => (r.id === run.id ? run : r))
        : [run, ...list];
    set((s) => ({
      runs: merge(s.runs),
      quickRuns: run.is_quick && s.quickRuns ? merge(s.quickRuns) : s.quickRuns,
      detailByRun: s.detailByRun[run.id]
        ? { ...s.detailByRun, [run.id]: { ...s.detailByRun[run.id], run } }
        : s.detailByRun,
    }));
  }

  function upsertAutomation(automation: RemoteAutomation): void {
    set((s) => ({
      automations: s.automations.some((a) => a.id === automation.id)
        ? s.automations.map((a) => (a.id === automation.id ? automation : a))
        : [...s.automations, automation],
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
      const [listed, ran] = await Promise.allSettled([
        request(t, "automations.list", {}),
        request(t, "automations.runs", { limit: RUN_LIMIT }),
      ]);
      if (listed.status === "rejected" && ran.status === "rejected") {
        if (!isQuietError(listed.reason, options?.background ?? false)) {
          set({ load: { loaded: true, error: describeError(listed.reason) } });
        }
        throw listed.reason;
      }
      set((s) => {
        const runs = ran.status === "fulfilled" ? ran.value.runs : s.runs;
        const started = new Set(runs.map((r) => r.automation_id));

        return {
          automations:
            listed.status === "fulfilled"
              ? listed.value.automations
              : s.automations,
          runs,
          // Anything that now has a run is no longer merely "starting".
          triggering: s.triggering.filter((id) => !started.has(id)),
          load: { loaded: true, error: null },
        };
      });
    },

    loadDetail: async (id) => {
      const t = currentTransport();
      if (!t) {
        return null;
      }
      const { automation } = await request(t, "automations.get", {
        automation_id: id,
      });
      set((s) => ({ detailById: { ...s.detailById, [id]: automation } }));

      return automation;
    },

    loadEditorOptions: async () => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      // Older computers answer neither; the editor degrades to free text.
      const [sources, runners] = await Promise.allSettled([
        request(t, "automations.sources", {}),
        request(t, "automations.runners", {}),
      ]);
      set((s) => ({
        sources:
          sources.status === "fulfilled" ? sources.value.sources : s.sources,
        runners:
          runners.status === "fulfilled" ? runners.value.runners : s.runners,
      }));
    },

    loadMemories: async (id) => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      const { memories } = await request(t, "automations.memories", {
        automation_id: id,
      });
      set((s) => ({ memoriesById: { ...s.memoriesById, [id]: memories } }));
    },

    loadCalibration: async (id) => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      const calibration = await request(t, "automations.calibration", {
        automation_id: id,
      });
      set((s) => ({
        calibrationById: { ...s.calibrationById, [id]: calibration },
      }));
    },

    loadRun: async (runId) => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      const detail = await request(t, "automations.run", { run_id: runId });
      set((s) => ({ detailByRun: { ...s.detailByRun, [runId]: detail } }));
    },

    loadQuickRuns: async () => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      try {
        const { runs } = await request(t, "automations.scratch_runs", {
          limit: RUN_LIMIT,
        });
        set({ quickRuns: runs });
      } catch (err) {
        if (isQuietError(err, true)) {
          return;
        }
        // A computer too old to list them alone leaves them among the recent ones.
        set((s) => ({ quickRuns: s.runs.filter((r) => r.is_quick) }));
      }
    },

    save: async (id, draft) => {
      const t = transport();
      const input = draftToInput(draft);
      const result = id
        ? await request(t, "automations.update", {
            automation_id: id,
            patch: input,
          })
        : await request(t, "automations.create", { input });
      capture("web_automation_edited", { action: id ? "save" : "create" });
      upsertAutomation(result.automation);
      set((s) => ({
        detailById: { ...s.detailById, [result.detail.id]: result.detail },
      }));

      return result.automation.id;
    },

    setEnabled: async (id, enabled) => {
      try {
        const { automation } = await request(
          transport(),
          "automations.set_enabled",
          { automation_id: id, enabled },
        );
        capture("web_automation_edited", {
          action: enabled ? "enable" : "disable",
        });
        upsertAutomation(automation);
        set((s) =>
          s.detailById[id]
            ? {
                detailById: {
                  ...s.detailById,
                  [id]: { ...s.detailById[id], enabled },
                },
              }
            : {},
        );
      } catch (err) {
        fail(enabled ? "Couldn't resume it" : "Couldn't pause it", err);
      }
    },

    remove: async (id) => {
      try {
        await request(transport(), "automations.delete", { automation_id: id });
        capture("web_automation_edited", { action: "delete" });
        set((s) => ({
          automations: s.automations.filter((a) => a.id !== id),
          runs: s.runs.filter((r) => r.automation_id !== id),
        }));

        return true;
      } catch (err) {
        fail("Couldn't delete that automation", err);

        return false;
      }
    },

    revisePlaybook: async (playbook, instruction, name) => {
      const result = await request(transport(), "automations.revise_playbook", {
        playbook,
        instruction,
        name: name.trim() || undefined,
      });
      capture("web_automation_edited", { action: "revise_playbook" });

      return result.playbook;
    },

    draft: async (description, regenerating) => {
      const result = await request(transport(), "automations.draft", {
        description,
        timezone: localTimezone(),
      });
      capture("web_automation_edited", {
        action: regenerating ? "regenerate" : "describe",
      });

      return result;
    },

    saveMemory: async (automationId, memory) => {
      await request(transport(), "automations.save_memory", {
        automation_id: automationId,
        memory,
      });
      capture("web_memory_edited", { action: "save" });
      await get()
        .loadMemories(automationId)
        .catch(() => {});
    },

    deleteMemory: async (automationId, name) => {
      try {
        await request(transport(), "automations.delete_memory", {
          automation_id: automationId,
          name,
        });
        capture("web_memory_edited", { action: "delete" });
        set((s) => ({
          memoriesById: {
            ...s.memoriesById,
            [automationId]: (s.memoriesById[automationId] ?? []).filter(
              (m) => m.name !== name,
            ),
          },
        }));
      } catch (err) {
        fail("Couldn't delete that memory", err);
      }
    },

    runNow: async (automationId) => {
      set((s) => ({ triggering: [...s.triggering, automationId] }));
      try {
        // A refused run comes back `skipped`, which still belongs in the list.
        const { run } = await request(transport(), "automations.run_now", {
          automation_id: automationId,
        });
        capture("web_run_acted", { action: "start" });
        upsertRun(run);
      } catch (err) {
        fail("Couldn't start that automation", err);
        set((s) => ({
          triggering: s.triggering.filter((id) => id !== automationId),
        }));
      }
      background();
    },

    runScratch: async (spec) => {
      const { run } = await request(transport(), "automations.run_scratch", {
        name: spec.name,
        playbook: spec.playbook,
        repo_roots: spec.repo_roots,
        source_ids: [],
        model: spec.model,
        guardrails: DEFAULT_GUARDRAILS,
      });
      capture("web_run_acted", { action: "start_scratch" });
      set((s) => ({
        runs: [run, ...s.runs],
        quickRuns: s.quickRuns ? [run, ...s.quickRuns] : [run],
      }));
      background();

      return run;
    },

    saveScratchRun: async (runId, name) => {
      // Saved paused: a playbook run once by hand has no schedule anyone chose.
      const { automation } = await request(
        transport(),
        "automations.save_scratch_run",
        { run_id: runId, name, enabled: false },
      );
      capture("web_run_acted", { action: "save_scratch" });
      upsertAutomation(automation);

      return automation.id;
    },

    sendRunFeedback: async (runId, note, allowClearing) => {
      const { run } = await request(transport(), "automations.run_feedback", {
        run_id: runId,
        note,
        allow_clearing: allowClearing,
      });
      capture("web_run_acted", { action: "feedback" });
      upsertRun(run);
      await get()
        .loadRun(runId)
        .catch(() => {});
    },

    cancelRun: async (runId) => {
      try {
        await request(transport(), "automations.cancel_run", { run_id: runId });
        capture("web_run_acted", { action: "cancel" });
      } catch (err) {
        fail("Couldn't cancel that run", err);
      }
      background();
    },

    deleteRun: async (runId) => {
      try {
        await request(transport(), "automations.delete_run", { run_id: runId });
        capture("web_run_acted", { action: "delete" });
        set((s) => {
          const { [runId]: _gone, ...detailByRun } = s.detailByRun;

          return {
            runs: s.runs.filter((r) => r.id !== runId),
            quickRuns: s.quickRuns?.filter((r) => r.id !== runId) ?? null,
            detailByRun,
          };
        });

        return true;
      } catch (err) {
        fail("Couldn't delete that run", err);

        return false;
      }
    },

    markRunRead: async (runId) => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      // Silent on failure: a lingering unread dot isn't worth an error.
      try {
        const { run } = await request(t, "automations.mark_run_read", {
          run_id: runId,
        });
        upsertRun(run);
      } catch {
        // Next refresh says how it stands.
      }
    },

    dismissRun: async (runId) => {
      await get().markRunRead(runId);
      capture("web_run_acted", { action: "mark_read" });
    },

    clearError: () => set({ error: null }),
  };
});

export function resetAutomations(): void {
  useAutomationsStore.setState(EMPTY);
}
