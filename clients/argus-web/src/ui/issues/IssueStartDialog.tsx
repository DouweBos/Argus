/**
 * Start agents on Linear issues, as the phone's start sheet does: one
 * worktree per issue on Linear's branch name, in the project picked here.
 */

import { useEffect, useRef, useState } from "react";
import {
  describeError,
  issueStartHint,
  preselectedIssueProject,
  REMOTE_PERMISSION_MODES,
} from "@argus/client-core";
import {
  Banner,
  BranchChip,
  Chip,
  Dialog,
  DialogBody,
  Icons,
  IssuePicker,
  PickerChip,
  StartComposer,
} from "@argus/peacock";
import type {
  LinearIssue,
  RemotePermissionMode,
} from "@argus/remote-protocol";
import { appNavigate } from "../../routing/router";
import { useConnectionStore } from "../../stores/connection";
import { useProjectsStore } from "../../stores/projects";
import { startFromIssues, useStartStore } from "../../stores/start";
import { capture } from "../../telemetry/telemetry";
import { useIssueSearch } from "./useIssueSearch";

const LAST_PROJECT_KEY = "argus-web:issue-start-project";
const DEFAULT = "";
const MODE_LABELS: Record<string, string> = {
  auto: "Auto",
  ask: "Ask",
  plan: "Plan",
  review: "Review",
};

function lastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

function rememberProject(repoRoot: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, repoRoot);
  } catch {
    // Private mode: pick it again next time.
  }
}

/** Picked issues as chips, and a picker to add more. */
function IssueChips({
  issues,
  onChange,
}: {
  issues: LinearIssue[];
  onChange: (issues: LinearIssue[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const search = useIssueSearch(picking);

  return (
    <>
      {issues.map((issue) => (
        <Chip
          key={issue.id}
          leading={<Icons.LinearIcon size={11} />}
          mono
          title={issue.title}
          onDismiss={
            issues.length > 1
              ? () => onChange(issues.filter((i) => i.id !== issue.id))
              : undefined
          }
        >
          {issue.identifier}
        </Chip>
      ))}
      <span ref={anchor}>
        <Chip interactive muted onClick={() => setPicking(true)}>
          Add issue
        </Chip>
      </span>
      {picking && (
        <IssuePicker
          error={search.error}
          items={search.issues.map((i) => ({
            id: i.id,
            identifier: i.identifier,
            title: i.title,
            state: i.state.name,
          }))}
          loading={search.loading}
          query={search.query}
          selectedIds={issues.map((i) => i.id)}
          triggerRef={anchor}
          onClose={() => setPicking(false)}
          onQueryChange={search.setQuery}
          onToggle={(item) => {
            const found = search.issues.find((i) => i.id === item.id);
            if (issues.some((i) => i.id === item.id)) {
              onChange(issues.filter((i) => i.id !== item.id));
            } else if (found) {
              onChange([...issues, found]);
            }
          }}
        />
      )}
    </>
  );
}

export function IssueStartDialog({
  issues: initial,
  onClose,
}: {
  issues: LinearIssue[];
  onClose: () => void;
}) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const projects = useProjectsStore((s) => s.projects);
  const { runners, baseBranchesByRepo, loadBaseBranches, loadRunners } =
    useStartStore();
  const [openedOn] = useState(() =>
    preselectedIssueProject(
      projects.map((p) => p.repo_root),
      lastProject(),
    ),
  );
  const [repoRoot, setRepoRoot] = useState(openedOn);
  const [issues, setIssues] = useState(initial);
  const [prompt, setPrompt] = useState("");
  const [pickedBase, setPickedBase] = useState<string | null>(null);
  const [mode, setMode] = useState<RemotePermissionMode | null>(null);
  const [runnerId, setRunnerId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branches = repoRoot ? baseBranchesByRepo[repoRoot] : undefined;
  const baseBranch = pickedBase ?? branches?.defaultBranch ?? null;
  const project = projects.find((p) => p.repo_root === repoRoot);

  useEffect(() => {
    if (ready && repoRoot) {
      loadBaseBranches(repoRoot, null).catch(() => {});
    }
  }, [ready, repoRoot, loadBaseBranches]);
  useEffect(() => {
    if (ready) {
      loadRunners().catch(() => {});
    }
  }, [ready, loadRunners]);

  const canSubmit =
    ready && !submitting && !!repoRoot && issues.length > 0;
  const submit = () => {
    if (!canSubmit || !repoRoot) {
      return;
    }
    setSubmitting(true);
    setError(null);
    capture("web_issue_start_submitted", {
      issue_count: issues.length,
      changed_project: repoRoot !== openedOn,
      has_prompt: prompt.trim().length > 0,
    });
    startFromIssues(issues, repoRoot, {
      baseBranch,
      message: prompt,
      model: null,
      permissionMode: mode,
      runnerId,
    })
      .then((started) => {
        rememberProject(repoRoot);
        onClose();
        if (started[0]) {
          appNavigate({ name: "sessionHome", sessionId: started[0].id });
        }
      })
      .catch((err: unknown) => setError(describeError(err)))
      .finally(() => setSubmitting(false));
  };

  let submitLabel =
    issues.length > 1 ? `Start ${issues.length} agents` : "Start agent";
  if (submitting) {
    submitLabel = "Starting…";
  }

  return (
    <Dialog
      size="medium"
      title="Start an agent"
      titleId="aw-issue-start"
      onClose={onClose}
    >
      <DialogBody>
        <StartComposer
          autoFocus
          canSubmit={canSubmit}
          chips={
            <>
              <IssueChips issues={issues} onChange={setIssues} />
              <PickerChip
                header="Project"
                label={project?.name ?? "Pick a project"}
                leading={<Icons.FolderIcon size={11} />}
                muted={!project}
                options={projects.map((p) => ({
                  value: p.repo_root,
                  name: p.name,
                }))}
                placement="below"
                selected={repoRoot ? [repoRoot] : []}
                title="Project to start in"
                onSelect={(value) => {
                  setRepoRoot(value);
                  setPickedBase(null);
                }}
              />
              {repoRoot && (
                <BranchChip
                  loading={!branches}
                  options={branches?.options ?? []}
                  placement="below"
                  value={baseBranch}
                  onChange={setPickedBase}
                />
              )}
              {runners.length > 1 && (
                <PickerChip
                  header="Runner"
                  label={
                    runners.find((r) => r.id === runnerId)?.display_name ??
                    "Default runner"
                  }
                  muted={!runnerId}
                  options={[
                    { value: DEFAULT, name: "Default" },
                    ...runners.map((r) => ({
                      value: r.id,
                      name: r.display_name,
                    })),
                  ]}
                  placement="below"
                  selected={[runnerId ?? DEFAULT]}
                  title="Runner"
                  onSelect={(v) => setRunnerId(v || null)}
                />
              )}
              <PickerChip
                header="Permission mode"
                label={mode ? MODE_LABELS[mode] : "Default mode"}
                muted={!mode}
                options={[
                  { value: DEFAULT, name: "Default" },
                  ...REMOTE_PERMISSION_MODES.map((m) => ({
                    value: m,
                    name: MODE_LABELS[m],
                  })),
                ]}
                placement="below"
                selected={[mode ?? DEFAULT]}
                title="Permission mode"
                onSelect={(v) =>
                  setMode(REMOTE_PERMISSION_MODES.find((m) => m === v) ?? null)
                }
              />
            </>
          }
          placeholder={issueStartHint(issues.length)}
          prompt={prompt}
          submitLabel={submitLabel}
          onPromptChange={setPrompt}
          onSubmit={submit}
        />
        {error && <Banner tone="error">{error}</Banner>}
      </DialogBody>
    </Dialog>
  );
}
