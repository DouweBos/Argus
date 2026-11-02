/**
 * A start composer's draft and its start: where the agent works, what it's
 * told, and what it runs on. Loads what the pickers offer as they're needed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildLinkedProjectsPreamble,
  canStart,
  describeError,
  initialWorkspace,
  type StartDraft,
  type StartWorkspace,
  workspaceOptions,
} from "@argus/client-core";
import { filesToPendingImages, type PendingImage } from "../../lib/images";
import type {
  RemotePermissionMode,
  RemoteSession,
} from "../../lib/protocol";
import { useConnectionStore } from "../../stores/connection";
import { type Started, useStartStore } from "../../stores/start";
import { capture } from "../../telemetry/telemetry";

const NO_MODELS: never[] = [];

export function useStartComposer(
  session: RemoteSession,
  projectRootBranch: string | null,
  onStarted: (started: Started) => void,
) {
  const connection = useConnectionStore((s) => s.connection);
  const store = useStartStore();
  // A scratch pad has no project to make worktrees in.
  const context = useMemo(
    () => ({
      sessionId: session.id,
      repoRoot: session.kind === "scratch_pad" ? null : session.repo_root,
    }),
    [session.id, session.kind, session.repo_root],
  );
  const openedOn = initialWorkspace(
    context,
    session.kind === "project_root" ? "worktree" : "current",
  );
  const [workspace, setWorkspace] = useState<StartWorkspace>(openedOn);
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [mode, setMode] = useState<RemotePermissionMode | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [runnerId, setRunnerId] = useState<string | null>(null);
  const [linked, setLinked] = useState<string[]>([]);
  const [pickedBase, setPickedBase] = useState<string | null>(null);
  const [existingBranch, setExistingBranch] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = connection === "ready";
  const { loadOptions, loadRunners, loadBaseBranches } = store;
  useEffect(() => {
    if (ready) {
      loadOptions(session.id, runnerId).catch(() => {});
    }
  }, [ready, loadOptions, session.id, runnerId]);
  useEffect(() => {
    if (ready) {
      loadRunners().catch(() => {});
    }
  }, [ready, loadRunners]);
  const needsBranches = workspace !== "current" && !!context.repoRoot;
  useEffect(() => {
    if (ready && needsBranches && context.repoRoot) {
      loadBaseBranches(context.repoRoot, projectRootBranch).catch(() => {});
    }
  }, [ready, needsBranches, loadBaseBranches, context.repoRoot, projectRootBranch]);

  // Until the host answers for this session, what the runner last reported.
  const offered = store.optionsBySession[session.id]?.models ?? NO_MODELS;
  const models =
    offered.length > 0
      ? offered
      : (store.runners.find((r) => r.id === (runnerId ?? "claude-code"))
          ?.reported_models ?? NO_MODELS);
  const branches = context.repoRoot
    ? store.baseBranchesByRepo[context.repoRoot]
    : undefined;
  const baseBranch = pickedBase ?? branches?.defaultBranch ?? null;
  const effortLevels =
    models.find((m) => m.value === model)?.supportedEffortLevels ?? [];

  const text = prompt.trim();
  const draft: StartDraft = {
    workspace,
    message: buildLinkedProjectsPreamble(
      linked,
      text || (images.length > 0 ? "(see attached images)" : ""),
    ),
    displayText: text || (images.length > 0 ? "(see attached images)" : ""),
    images: images.map((i) => i.attachment),
    model,
    permissionMode: mode,
    effort: effortLevels.includes(effort ?? "") ? effort : null,
    runnerId,
    baseBranch,
    existingBranch,
  };
  // A worktree is named from the prompt; an image alone can't name it.
  const startable =
    ready &&
    !submitting &&
    canStart(
      workspace === "current" ? draft : { ...draft, displayText: text },
      context,
    );

  const addImages = useCallback(async (files: File[]) => {
    const next = await filesToPendingImages(files);
    if (next.length > 0) {
      setImages((prev) => [...prev, ...next]);
    }
  }, []);

  const submit = () => {
    if (!startable) {
      return;
    }
    setSubmitting(true);
    setError(null);
    capture("web_agent_start_submitted", {
      workspace,
      changed_workspace: workspace !== openedOn,
      has_images: images.length > 0,
      effort_set: draft.effort !== null,
    });
    store
      .start(context, draft)
      .then((started) => {
        setPrompt("");
        images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
        setImages([]);
        onStarted(started);
      })
      .catch((err: unknown) => setError(describeError(err)))
      .finally(() => setSubmitting(false));
  };

  return {
    context,
    options: workspaceOptions(context),
    workspace,
    setWorkspace,
    prompt,
    setPrompt,
    images,
    setImages,
    addImages,
    models,
    model,
    setModel,
    mode,
    setMode,
    effortLevels,
    effort: draft.effort,
    setEffort,
    runners: store.runners,
    runnerId,
    setRunnerId,
    linked,
    setLinked,
    branches,
    baseBranch,
    setPickedBase,
    existingBranch,
    setExistingBranch,
    submitting,
    startable,
    submit,
    error,
  };
}
