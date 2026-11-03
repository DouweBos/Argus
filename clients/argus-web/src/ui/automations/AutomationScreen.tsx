/**
 * `/automations/:automationId`: what it does, edited in place, what it
 * remembers, and every time it ran.
 */

import type {
  RemoteAutomation,
  RemoteAutomationDetail,
} from "@argus/remote-protocol";
import { useCallback, useEffect, useState } from "react";
import {
  automationProjectOptions,
  describeError,
  draftChanged,
  draftScheduleError,
  isRunActive,
  nextRunLabel,
  scheduleLabel,
} from "@argus/client-core";
import {
  AutomationDetailView,
  AutomationFields,
  AutomationMemories,
  AutomationTrackRecord,
  Button,
  DestructiveConfirm,
  remoteRunEntry,
  RevisePlaybookDialog,
  RunHistory,
  Toggle,
} from "@argus/peacock";
import { appNavigate, navigateBack } from "../../routing/router";
import { useAutomationsStore } from "../../stores/automations";
import { useClaudeAccountsStore } from "../../stores/claudeAccounts";
import { useConnectionStore } from "../../stores/connection";
import { useProjectsStore } from "../../stores/projects";
import { useLiveRefresh } from "../useLiveRefresh";
import { RunControl } from "./AutomationsScreen";
import { INBOX_REFRESH_MS } from "./useInbox";

/** "07:30 weekdays · next Nov 3, 07:30 (in 18h)", "… · paused", or "Manual". */
function automationMeta(automation: RemoteAutomation): string {
  if (automation.trigger_kind === "manual") {
    return "Manual — runs when someone presses Run now";
  }
  const schedule = scheduleLabel(automation);

  return automation.enabled
    ? `${schedule} · next ${nextRunLabel(automation)}`
    : `${schedule} · paused`;
}

export function AutomationScreen({ automationId }: { automationId: string }) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const projects = useProjectsStore((s) => s.projects);
  const automation = useAutomationsStore((s) =>
    s.automations.find((a) => a.id === automationId),
  );
  const saved = useAutomationsStore((s) => s.detailById[automationId]);
  const memories = useAutomationsStore((s) => s.memoriesById[automationId]);
  const calibration = useAutomationsStore(
    (s) => s.calibrationById[automationId],
  );
  const allRuns = useAutomationsStore((s) => s.runs);
  const sources = useAutomationsStore((s) => s.sources);
  const runners = useAutomationsStore((s) => s.runners);
  const accounts = useClaudeAccountsStore((s) => s.accounts);
  const activeAccountId = useClaudeAccountsStore((s) => s.activeId);
  const store = useAutomationsStore.getState;
  const runs = allRuns.filter((r) => r.automation_id === automationId);

  const [draft, setDraft] = useState<RemoteAutomationDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!ready) {
      return;
    }
    setMissing(false);
    store()
      .loadDetail(automationId)
      .then((detail) => detail && setDraft((d) => d ?? detail))
      .catch(() => setMissing(true));
    void store().loadMemories(automationId).catch(() => {});
    void store().loadEditorOptions();
    if (useClaudeAccountsStore.getState().accounts === null) {
      void useClaudeAccountsStore
        .getState()
        .refresh({ background: true })
        .catch(() => {});
    }
    if (projects.length === 0) {
      void useProjectsStore
        .getState()
        .refreshProjects({ background: true })
        .catch(() => {});
    }
  }, [ready, automationId, store, projects.length]);

  // The track record follows the run history.
  useEffect(() => {
    if (ready) {
      void store().loadCalibration(automationId).catch(() => {});
    }
  }, [ready, automationId, runs.length, store]);

  const poll = useCallback(
    () => void store().refresh({ background: true }).catch(() => {}),
    [store],
  );
  useLiveRefresh(ready, poll, INBOX_REFRESH_MS);

  const dirty = Boolean(draft && saved && draftChanged(draft, saved));
  const scheduleError = draft ? draftScheduleError(draft) : null;

  const save = async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await store().save(automationId, draft);
      const fresh = store().detailById[automationId];
      if (fresh) {
        setDraft(fresh);
      }
    } catch (err) {
      setSaveError(`Couldn't save it — ${describeError(err)}`);
    } finally {
      setSaving(false);
    }
  };

  let saveLabel = "Saved";
  if (saving) {
    saveLabel = "Saving…";
  } else if (dirty) {
    saveLabel = "Save changes";
  }
  const latest = runs[0];
  const name = automation?.name ?? saved?.name ?? null;

  return (
    <div className="aw-automations">
      <AutomationDetailView
        actions={
          hasControl &&
          automation && (
            <>
              <Toggle
                checked={automation.enabled}
                onChange={(enabled) =>
                  void store().setEnabled(automationId, enabled)
                }
              >
                {automation.enabled ? "Enabled" : "Paused"}
              </Toggle>
              <RunControl automation={automation} latest={latest} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            </>
          )
        }
        configuration={
          draft && (
            <AutomationFields
              disabled={!hasControl}
              draft={draft}
              accounts={accounts ?? []}
              activeAccountId={activeAccountId}
              projects={automationProjectOptions(projects, draft.repo_roots)}
              runners={runners}
              sources={sources}
              onChange={setDraft}
              onRevisePlaybook={hasControl ? () => setRevising(true) : undefined}
            />
          )
        }
        error={saveError ?? (draft ? scheduleError : null)}
        loading={!missing}
        memories={
          <AutomationMemories
            memories={memories ?? null}
            onDelete={
              hasControl
                ? (memoryName) => void store().deleteMemory(automationId, memoryName)
                : undefined
            }
            onSave={
              hasControl
                ? (memory) => store().saveMemory(automationId, memory)
                : undefined
            }
          />
        }
        meta={automation ? automationMeta(automation) : undefined}
        missingAction={
          <Button size="sm" onClick={() => appNavigate({ name: "automations" })}>
            Back to automations
          </Button>
        }
        name={missing ? null : name}
        runs={
          <RunHistory
            actions={(run) =>
              hasControl && isRunActive(run) ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void store().cancelRun(run.id)}
                >
                  Cancel
                </Button>
              ) : undefined
            }
            empty="This automation has never run. Press Run now to see what it does."
            runs={runs.map((r) => remoteRunEntry(r))}
            onOpen={(runId) =>
              appNavigate({ name: "automationRun", automationId, runId })
            }
          />
        }
        saveAction={
          hasControl && (
            <Button
              disabled={saving || !dirty || scheduleError !== null}
              size="sm"
              onClick={() => void save()}
            >
              {saveLabel}
            </Button>
          )
        }
        trackRecord={<AutomationTrackRecord calibration={calibration ?? null} />}
      />
      {revising && draft && (
        <RevisePlaybookDialog
          onApply={(playbook) => setDraft({ ...draft, playbook })}
          onClose={() => setRevising(false)}
          onRevise={(instruction) =>
            store().revisePlaybook(draft.playbook, instruction, draft.name)
          }
        />
      )}
      <DestructiveConfirm
        cancelLabel="Keep it"
        confirmLabel="Delete automation"
        description="Its schedule, playbook and memories go for good. This cannot be undone."
        open={confirmingDelete}
        title="Delete this automation?"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          void store()
            .remove(automationId)
            .then(
              (ok) => ok && navigateBack({ name: "automations" }),
            );
        }}
      />
    </div>
  );
}
