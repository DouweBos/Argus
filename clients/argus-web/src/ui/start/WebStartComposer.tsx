/**
 * The start composer, as the phone's start sheet and the Mac's composer
 * have it: the task, then the current checkout / a new worktree / an existing
 * branch, its base, and the runner, model, mode, effort and linked projects.
 */

import { useRef } from "react";
import { REMOTE_PERMISSION_MODES } from "@argus/client-core";
import {
  Banner,
  BranchChip,
  Icons,
  ImageAttachmentStrip,
  PickerChip,
  StartComposer,
  StartWorkspaceChip,
} from "@argus/peacock";
import {
  ACCEPTED_IMAGE_TYPES,
  extractImageFilesFromClipboard,
} from "../../lib/images";
import type { RemoteSession } from "../../lib/protocol";
import { useProjectsStore } from "../../stores/projects";
import type { Started } from "../../stores/start";
import { useStartComposer } from "./useStartComposer";

const MODE_LABELS: Record<string, string> = {
  auto: "Auto",
  ask: "Ask",
  plan: "Plan",
  review: "Review",
};

const DEFAULT = "";

export function WebStartComposer({
  session,
  projectRootBranch,
  onStarted,
}: {
  session: RemoteSession;
  projectRootBranch: string | null;
  onStarted: (started: Started) => void;
}) {
  const c = useStartComposer(session, projectRootBranch, onStarted);
  const projects = useProjectsStore((s) => s.projects);
  const refreshProjects = useProjectsStore((s) => s.refreshProjects);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelName = c.models.find((m) => m.value === c.model)?.displayName;
  const runnerName = c.runners.find((r) => r.id === c.runnerId)?.display_name;
  const otherProjects = projects.filter(
    (p) => p.repo_root !== session.repo_root,
  );

  let submitLabel = "Start agent";
  if (c.submitting) {
    submitLabel = "Starting…";
  }

  return (
    <>
      <StartComposer
        attachments={
          <ImageAttachmentStrip
            items={c.images}
            onRemove={(i) =>
              c.setImages((prev) => {
                const removed = prev[i];
                if (removed) {
                  URL.revokeObjectURL(removed.previewUrl);
                }

                return prev.filter((_, idx) => idx !== i);
              })
            }
          />
        }
        canSubmit={c.startable}
        chips={
          <>
            {c.options.length > 1 && (
              <StartWorkspaceChip
                currentBranch={session.branch}
                currentLabel={
                  session.kind === "project_root"
                    ? "Current checkout"
                    : "This worktree"
                }
                existingBranch={c.existingBranch}
                options={c.options}
                placement="below"
                value={c.workspace}
                onChange={c.setWorkspace}
              />
            )}
            {c.workspace === "worktree" && (
              <BranchChip
                loading={!c.branches}
                options={c.branches?.options ?? []}
                placement="below"
                value={c.baseBranch}
                onChange={c.setPickedBase}
              />
            )}
            {c.workspace === "existing" && (
              <BranchChip
                format={(b) => b}
                header="Existing branch"
                loading={!c.branches}
                options={c.branches?.local ?? []}
                placeholder="Pick a branch"
                placement="below"
                title="Branch to check out"
                value={c.existingBranch}
                onChange={c.setExistingBranch}
              />
            )}
            {c.runners.length > 1 && (
              <PickerChip
                header="Runner"
                label={runnerName ?? "Default runner"}
                muted={!c.runnerId}
                options={[
                  { value: DEFAULT, name: "Default" },
                  ...c.runners.map((r) => ({
                    value: r.id,
                    name: r.display_name,
                  })),
                ]}
                placement="below"
                selected={[c.runnerId ?? DEFAULT]}
                title="Runner"
                onSelect={(v) => {
                  c.setRunnerId(v || null);
                  c.setModel(null);
                }}
              />
            )}
            <PickerChip
              header="Permission mode"
              label={c.mode ? MODE_LABELS[c.mode] : "Default mode"}
              muted={!c.mode}
              options={[
                { value: DEFAULT, name: "Default" },
                ...REMOTE_PERMISSION_MODES.map((m) => ({
                  value: m,
                  name: MODE_LABELS[m],
                })),
              ]}
              placement="below"
              selected={[c.mode ?? DEFAULT]}
              title="Permission mode"
              onSelect={(v) =>
                c.setMode(REMOTE_PERMISSION_MODES.find((m) => m === v) ?? null)
              }
            />
            {c.models.length > 0 && (
              <PickerChip
                mono
                muted
                empty="Loading models…"
                header="Model"
                label={modelName ?? "Default model"}
                options={[
                  // The CLI lists its own "default"; only add ours without it.
                  ...(c.models.some((m) => m.value === "default")
                    ? []
                    : [{ value: DEFAULT, name: "Default" }]),
                  ...c.models.map((m) => ({
                    value: m.value,
                    name: m.displayName,
                    description: m.description,
                  })),
                ]}
                placement="below"
                selected={[c.model ?? DEFAULT]}
                title="Model"
                onSelect={(v) => c.setModel(v || null)}
              />
            )}
            {c.effortLevels.length > 0 && (
              <PickerChip
                header="Effort"
                label={c.effort ?? "Effort"}
                muted={!c.effort}
                options={[
                  { value: DEFAULT, name: "Default" },
                  ...c.effortLevels.map((l) => ({ value: l, name: l })),
                ]}
                placement="below"
                selected={[c.effort ?? DEFAULT]}
                title="Reasoning effort"
                onSelect={(v) => c.setEffort(v || null)}
              />
            )}
            <PickerChip
              multiple
              empty="No other projects open"
              header="Link projects"
              label={
                c.linked.length === 0
                  ? "Link project"
                  : `${c.linked.length} linked`
              }
              leading={<Icons.FolderIcon size={11} />}
              muted={c.linked.length === 0}
              options={otherProjects.map((p) => ({
                value: p.repo_root,
                name: p.name,
              }))}
              placement="below"
              selected={c.linked}
              title="Link other projects"
              onOpen={() => {
                refreshProjects({ background: true }).catch(() => {});
              }}
              onSelect={(path) =>
                c.setLinked((prev) =>
                  prev.includes(path)
                    ? prev.filter((p) => p !== path)
                    : [...prev, path],
                )
              }
            />
          </>
        }
        placeholder={
          c.workspace === "current"
            ? "What should it do?"
            : "What should it do? The new branch is named from this."
        }
        prompt={c.prompt}
        submitLabel={submitLabel}
        onAttach={() => fileInputRef.current?.click()}
        onDrop={(e) => {
          const files = e.dataTransfer?.files;
          if (files && files.length > 0) {
            e.preventDefault();
            c.addImages(Array.from(files)).catch(() => {});
          }
        }}
        onPaste={(e) => {
          const files = extractImageFilesFromClipboard(e);
          if (files.length > 0) {
            e.preventDefault();
            c.addImages(files).catch(() => {});
          }
        }}
        onPromptChange={c.setPrompt}
        onSubmit={c.submit}
      >
        <input
          ref={fileInputRef}
          accept={ACCEPTED_IMAGE_TYPES}
          className="aw-hidden-file-input"
          multiple
          tabIndex={-1}
          type="file"
          onChange={(e) => {
            const files = e.target.files;
            if (files) {
              c.addImages(Array.from(files)).catch(() => {});
            }
            e.target.value = "";
          }}
        />
      </StartComposer>
      {c.error && <Banner tone="error">{c.error}</Banner>}
    </>
  );
}
