/**
 * One firing — `/automations/:automationId/runs/:runId`, or under Quick Run
 * for an ad-hoc one: how it went, what it cost, its report, and the way to
 * argue with it, keep it as an automation, or open the agent that did it.
 */

import { useCallback, useEffect, useState } from "react";
import {
  describeError,
  formatCost,
  formatRunDuration,
  formatTimestamp,
  isRunActive,
} from "@argus/client-core";
import {
  AutomationRunView,
  Badge,
  Button,
  ConfidenceMeter,
  DestructiveConfirm,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  FormField,
  Icons,
  Input,
  type ReportRef,
  RunFeedbackDialog,
  RunReport,
  Spinner,
} from "@argus/peacock";
import { openAgent } from "../../routing/open";
import { appNavigate, navigateBack } from "../../routing/router";
import type { Screen } from "../../routing/screens";
import { useAutomationsStore } from "../../stores/automations";
import { useConnectionStore } from "../../stores/connection";
import { useProjectsStore } from "../../stores/projects";
import { useProposalsStore } from "../../stores/proposals";
import { useLiveRefresh } from "../useLiveRefresh";

function SaveAsAutomationDialog({
  initial,
  onClose,
  onSave,
}: {
  initial: string;
  onClose: () => void;
  onSave: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      size="medium"
      title="Save as automation"
      titleId="aw-save-quick-run"
      onClose={onClose}
    >
      <DialogBody>
        <FormField
          error={error ?? undefined}
          helper="Keeps the playbook and scope. It's saved paused, with no schedule."
          label="Name"
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={saving || name.trim().length === 0}
          onClick={() => {
            setSaving(true);
            onSave(name.trim()).catch((err: unknown) => {
              setError(describeError(err));
              setSaving(false);
            });
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** Proposals and sessions a report points at, resolved against what the stores hold now. */
function useReportRefs() {
  const pending = useProposalsStore((s) => s.pending);
  const recent = useProposalsStore((s) => s.recent);
  const sessionsByRepo = useProjectsStore((s) => s.sessionsByRepo);

  const resolveProposal = (id: string): ReportRef | null => {
    const proposal =
      pending.find((p) => p.id === id) ?? recent.find((p) => p.id === id);

    return proposal
      ? {
          id,
          title: proposal.title,
          subtitle: proposal.project ?? undefined,
          meta: <ConfidenceMeter compact value={proposal.confidence} />,
          onOpen: () => appNavigate({ name: "proposal", proposalId: id }),
        }
      : null;
  };
  const resolveSession = (id: string): ReportRef | null => {
    const session = Object.values(sessionsByRepo)
      .flat()
      .find((s) => s.id === id);

    return session
      ? {
          id,
          title: session.display_name ?? session.branch,
          meta: <Badge tone="neutral">{session.status}</Badge>,
          onOpen: () => appNavigate({ name: "session", sessionId: id }),
        }
      : null;
  };

  return { resolveProposal, resolveSession };
}

export function RunScreen({
  parent,
  runId,
}: {
  /** Where Back and a deletion go: the automation, or Quick Run. */
  parent: Screen;
  runId: string;
}) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const detail = useAutomationsStore((s) => s.detailByRun[runId]);
  const listed = useAutomationsStore((s) => s.runs.find((r) => r.id === runId));
  const store = useAutomationsStore.getState;
  const refs = useReportRefs();
  const [missing, setMissing] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const run = detail?.run ?? listed;
  const active = run ? isRunActive(run) : true;

  useEffect(() => {
    if (!ready) {
      return;
    }
    store()
      .loadRun(runId)
      .then(() => {
        // Opening a report is reading it, on the computer too.
        if (store().detailByRun[runId]?.run.unread_report) {
          void store().markRunRead(runId);
        }
      })
      .catch(() => setMissing(true));
  }, [ready, runId, store]);

  // A settled run's report never changes, so stop asking once it has.
  const poll = useCallback(
    () => void store().loadRun(runId).catch(() => {}),
    [runId, store],
  );
  useLiveRefresh(ready && active && !missing, poll, 5000);

  if (!run) {
    return missing ? (
      <EmptyState
        action={
          <Button size="sm" onClick={() => appNavigate(parent)}>
            Back
          </Button>
        }
        body="Runs are pruned once an automation has fifty of them."
        icon={<Icons.ClockIcon size={18} />}
        title="Run not found"
      />
    ) : (
      <div className="aw-center">
        <Spinner />
      </div>
    );
  }

  const actions = (
    <>
      {run.host_agent_id && run.host_session_id && (
        <Button
          leading={<Icons.AgentIcon size={11} />}
          size="sm"
          variant="secondary"
          onClick={() =>
            openAgent({
              agent_id: run.host_agent_id as string,
              session_id: run.host_session_id as string,
            })
          }
        >
          Open agent
        </Button>
      )}
      {hasControl && !active && run.host_session_id && (
        <Button
          leading={<Icons.ChatIcon size={11} />}
          size="sm"
          variant="secondary"
          onClick={() => setFeedback(true)}
        >
          Give feedback
        </Button>
      )}
      {hasControl && run.is_quick && !active && (
        <Button
          leading={<Icons.PlusIcon size={11} />}
          size="sm"
          variant="secondary"
          onClick={() => setSaving(true)}
        >
          Save as automation
        </Button>
      )}
      {hasControl && active && (
        <Button
          size="sm"
          variant="danger"
          onClick={() => void store().cancelRun(run.id)}
        >
          Cancel
        </Button>
      )}
      {hasControl && !active && (
        <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      )}
    </>
  );

  return (
    <div className="aw-automations">
      <AutomationRunView
        actions={actions}
        cost={formatCost(run.cost_usd)}
        duration={formatRunDuration(run)}
        error={run.error}
        feedback={detail?.feedback}
        finished={run.finished_at ? formatTimestamp(run.finished_at) : "—"}
        live={active}
        reason={
          run.is_quick
            ? `${run.trigger_reason} · ${run.automation_name}`
            : run.trigger_reason
        }
        report={
          detail ? (
            <RunReport
              active={active}
              blocks={detail.report_blocks}
              markdown={detail.report_markdown}
              resolveProposal={refs.resolveProposal}
              resolveSession={refs.resolveSession}
              onOpenLink={(href) =>
                window.open(href, "_blank", "noopener,noreferrer")
              }
            />
          ) : (
            <Spinner />
          )
        }
        status={run.status}
        title={formatTimestamp(run.started_at)}
      />
      {feedback && (
        <RunFeedbackDialog
          onClose={() => setFeedback(false)}
          onSend={(note, allowClearing) =>
            store().sendRunFeedback(run.id, note, allowClearing)
          }
        />
      )}
      {saving && (
        <SaveAsAutomationDialog
          initial={run.automation_name}
          onClose={() => setSaving(false)}
          onSave={async (name) => {
            const id = await store().saveScratchRun(run.id, name);
            setSaving(false);
            appNavigate({ name: "automation", automationId: id });
          }}
        />
      )}
      <DestructiveConfirm
        cancelLabel="Keep it"
        confirmLabel="Delete run"
        description="The run, its report and any proposals it raised are removed. This cannot be undone."
        open={deleting}
        title="Delete this run?"
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false);
          void store()
            .deleteRun(run.id)
            .then((ok) => ok && navigateBack(parent));
        }}
      />
    </div>
  );
}
