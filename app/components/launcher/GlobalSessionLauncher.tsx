import type { ProjectEntry, Session } from "../../lib/types";
import type { PendingImage } from "../../stores/conversationStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Chip,
  Icons,
  ImageAttachmentStrip,
  TextArea,
} from "@argus/peacock";
import { listen } from "../../lib/events";
import {
  ACCEPTED_IMAGE_TYPES,
  extractImageFilesFromClipboard,
  filesToPendingImages,
} from "../../lib/imageAttachments";
import {
  createHeadSession,
  createSession,
  type ImageAttachment,
  launcherHide,
  listAllBranches,
  listProjects,
  listSessions,
  navigateMainWindow,
  readArgusConfig,
  setPendingSessionPromptViaBroadcast,
} from "../../lib/ipc";
import { getLastKnownCapabilities } from "../../lib/lastKnownCapabilities";
import { openImageViewer } from "../../stores/imageViewerStore";
import { useRegisteredRunners } from "../../stores/runnersStore";
import { getDefaultModel, useDefaultLlm } from "../../stores/settingsStore";
import { ModelPicker, type RunnerSelection } from "../agent/ModelPicker";
import styles from "./GlobalSessionLauncher.module.css";
import {
  LauncherLinkedPopover,
  LauncherProjectPopover,
  LauncherSessionPopover,
} from "./LauncherPopover";

type SessionMode =
  | { kind: "existing"; sessionId: string }
  | { kind: "new" }
  | { kind: "root" };

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);

  return parts[parts.length - 1] ?? p;
}

function base64PngToBlob(b64: string, type: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type });
}

function pickDefaultBaseBranch(
  local: string[],
  configured: string | null,
): string | null {
  if (configured && local.includes(configured)) {
    return configured;
  }
  for (const candidate of ["staging", "develop", "dev", "main", "master"]) {
    if (local.includes(candidate)) {
      return candidate;
    }
  }

  return local[0] ?? null;
}

export function GlobalSessionLauncher() {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [project, setProject] = useState<ProjectEntry | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionMode, setSessionMode] = useState<SessionMode>({ kind: "root" });

  const [prompt, setPrompt] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [linkedProjects, setLinkedProjects] = useState<string[]>([]);
  const [modelValue, setModelValue] = useState<string>(
    () => getDefaultModel() || "default",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Picker open-state. Each one is a portaled popover anchored above the
  // chip; the launcher's fullscreen window means they never get clipped.
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [linkedPickerOpen, setLinkedPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  // Branch info for "new session" flow
  const [baseBranch, setBaseBranch] = useState<string | null>(null);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectChipRef = useRef<HTMLDivElement>(null);
  const sessionChipRef = useRef<HTMLDivElement>(null);
  const linkedChipRef = useRef<HTMLDivElement>(null);
  const modelChipRef = useRef<HTMLDivElement>(null);

  const { models: knownModels } = useMemo(() => getLastKnownCapabilities(), []);

  // Runner selection. Existing-session targets inherit (and lock) the
  // session's runner; new-session targets propose the app default and let
  // the user switch (single-option dropdown today).
  const registeredRunners = useRegisteredRunners();
  const defaultLlm = useDefaultLlm();
  const [newSessionRunnerId, setNewSessionRunnerId] = useState<string>(
    () => defaultLlm.runner ?? "claude-code",
  );
  useEffect(() => {
    if (defaultLlm.runner && newSessionRunnerId === "claude-code") {
      setNewSessionRunnerId(defaultLlm.runner);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultLlm.runner]);
  const targetSession =
    sessionMode.kind === "existing"
      ? (sessions.find((s) => s.id === sessionMode.sessionId) ?? null)
      : null;
  const runnerSelection: RunnerSelection =
    targetSession != null
      ? {
          currentId: targetSession.runner_id ?? "claude-code",
          locked: true,
          available: registeredRunners,
        }
      : {
          currentId: newSessionRunnerId,
          locked: false,
          available: registeredRunners,
          onSelect: setNewSessionRunnerId,
        };

  // Initial project load.
  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((list) => {
        if (cancelled) {
          return;
        }
        setProjects(list);
        // Default to the first project so submission is possible without
        // picking — most users will only have a handful registered.
        if (list.length > 0) {
          setProject((prev) => prev ?? list[0]);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Sessions + base branches load whenever the project changes.
  useEffect(() => {
    if (!project) {
      setSessions([]);
      setBaseBranch(null);

      return;
    }
    let cancelled = false;
    Promise.all([
      listSessions(project.path).catch(() => [] as Session[]),
      listAllBranches(project.path).catch(() => ({
        local: [] as string[],
        remote: [] as string[],
      })),
      readArgusConfig(project.path).catch(() => null),
    ]).then(([sList, branches, config]) => {
      if (cancelled) {
        return;
      }
      setSessions(sList);
      const configured = config?.default_base_branch?.trim() || null;
      setBaseBranch(pickDefaultBaseBranch(branches.local, configured));
    });

    return () => {
      cancelled = true;
    };
  }, [project]);

  // Revoke object URLs on unmount so previews don't leak.
  useEffect(() => {
    return () => {
      for (const img of pendingImages) {
        URL.revokeObjectURL(img.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-focus the prompt textarea when the launcher mounts.
  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  // ---- Image handling (paste, paperclip, drag & drop) ----
  const addImageFiles = useCallback(async (files: File[]) => {
    const newImages = await filesToPendingImages(files);
    if (newImages.length > 0) {
      setPendingImages((prev) => [...prev, ...newImages]);
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setPendingImages((prev) => {
      const removed = prev[index];
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
      }

      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handlePromptPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const imageFiles = extractImageFilesFromClipboard(e);
      if (imageFiles.length > 0) {
        e.preventDefault();
        addImageFiles(imageFiles);
      }
    },
    [addImageFiles],
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) {
        return;
      }
      await addImageFiles(Array.from(files));
      e.target.value = "";
      promptRef.current?.focus();
    },
    [addImageFiles],
  );

  // The backend keeps a fullscreen 20%-black capture backdrop open behind
  // the launcher whenever it's shown. Each rect the user drags gets cropped
  // and broadcast back as `area-capture:attached`; we just append to the
  // pending images.
  useEffect(() => {
    const unlistenP = listen<ImageAttachment>(
      "area-capture:attached",
      ({ payload }) => {
        if (!payload) {
          return;
        }
        const blob = base64PngToBlob(payload.data, payload.media_type);
        const previewUrl = URL.createObjectURL(blob);
        setPendingImages((prev) => [
          ...prev,
          {
            name: `screenshot-${new Date().toISOString().slice(11, 19)}.png`,
            previewUrl,
            attachment: payload,
          },
        ]);
      },
    );

    return () => {
      unlistenP.then((un) => un()).catch(() => undefined);
    };
  }, []);

  const toggleLinkedProject = useCallback((path: string) => {
    setLinkedProjects((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  }, []);

  // ---- Submit ----
  const trimmedPrompt = prompt.trim();
  const canSubmit =
    !!project &&
    !submitting &&
    (trimmedPrompt.length > 0 || pendingImages.length > 0) &&
    (sessionMode.kind !== "new" || !!baseBranch);

  const submit = useCallback(async () => {
    if (!project || !canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);

    const images: ImageAttachment[] = pendingImages.map((p) => p.attachment);
    const model = modelValue !== "default" ? modelValue : undefined;

    try {
      let targetSessionId: string;

      if (sessionMode.kind === "existing") {
        targetSessionId = sessionMode.sessionId;
      } else if (sessionMode.kind === "root") {
        const head = await createHeadSession(project.path);
        targetSessionId = head.id;
      } else {
        // New session — backend generates branch name from the prompt.
        const description = trimmedPrompt || "(launcher-spawned session)";
        const created = await createSession(
          project.path,
          "",
          description,
          false,
          baseBranch ?? undefined,
        );
        targetSessionId = created.id;
      }

      // Route every mode through the pending-prompt broadcast. The main
      // window's `initPendingSessionPrompts` listener spawns the agent and
      // sends the message via `sendUserMessageToAgent`, which adds the user
      // turn to that window's conversationStore. Sending directly from this
      // launcher renderer would skip that step — the prompt would reach the
      // backend but never appear in the main window's transcript, since each
      // BrowserWindow has its own store.
      await setPendingSessionPromptViaBroadcast({
        sessionId: targetSessionId,
        prompt: trimmedPrompt,
        images: images.length > 0 ? images : undefined,
        model,
        linkedProjects: linkedProjects.length > 0 ? linkedProjects : undefined,
      });
      await navigateMainWindow(`/sessions/${targetSessionId}`);
      await launcherHide();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }, [
    baseBranch,
    canSubmit,
    linkedProjects,
    modelValue,
    pendingImages,
    project,
    sessionMode,
    trimmedPrompt,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
        e.preventDefault();
        submit();
      }
    },
    [canSubmit, submit],
  );

  // ---- Picker labels ----
  const projectLabel = project ? basename(project.path) : "Pick project";
  const sessionLabel = (() => {
    if (sessionMode.kind === "root") {
      return "Project root";
    }
    if (sessionMode.kind === "new") {
      return "New session";
    }
    const match = sessions.find((s) => s.id === sessionMode.sessionId);

    return (
      match?.display_name ?? match?.branch ?? sessionMode.sessionId.slice(0, 8)
    );
  })();
  const modelDisplayName = useMemo(() => {
    if (!knownModels.length) {
      return undefined;
    }
    const match = knownModels.find((m) => m.value === modelValue);

    return match?.displayName ?? knownModels[0]?.displayName;
  }, [knownModels, modelValue]);

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className={styles.promptWrap}>
        <TextArea
          ref={promptRef}
          autoFocus
          className={styles.prompt}
          placeholder="What can I help you with today?"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePromptPaste}
        />
        <button
          aria-label="Attach image"
          className={styles.promptAttachBtn}
          type="button"
          title="Attach image"
          onClick={() => fileInputRef.current?.click()}
        >
          <Icons.PaperclipIcon />
        </button>
      </div>

      <ImageAttachmentStrip
        className={styles.attachments}
        items={pendingImages}
        onPreview={(i) => {
          const img = pendingImages[i];
          if (!img) {
            return;
          }
          openImageViewer(
            `data:${img.attachment.media_type};base64,${img.attachment.data}`,
            img.name,
            img.previewUrl,
          );
        }}
        onRemove={removeImage}
      />

      <div className={styles.chips}>
        <div ref={projectChipRef} className={styles.chipAnchor}>
          <Chip
            interactive
            selected={projectPickerOpen}
            leading={<Icons.RepoIcon size={11} />}
            title="Pick project"
            onClick={() => setProjectPickerOpen((o) => !o)}
          >
            {projectLabel}
          </Chip>
          {projectPickerOpen && (
            <LauncherProjectPopover
              triggerRef={projectChipRef}
              projects={projects}
              selectedPath={project?.path ?? null}
              onSelect={(p) => {
                setProject(p);
                setSessionMode({ kind: "root" });
                setProjectPickerOpen(false);
              }}
              onClose={() => setProjectPickerOpen(false)}
            />
          )}
        </div>

        <div ref={sessionChipRef} className={styles.chipAnchor}>
          <Chip
            interactive
            muted={sessionMode.kind === "root"}
            selected={sessionPickerOpen}
            leading={<Icons.BranchIcon size={11} />}
            title="Pick a session, or run in project root"
            onClick={() => setSessionPickerOpen((o) => !o)}
          >
            {sessionLabel}
          </Chip>
          {sessionPickerOpen && project && (
            <LauncherSessionPopover
              triggerRef={sessionChipRef}
              sessions={sessions}
              mode={sessionMode}
              onSelect={(mode) => {
                setSessionMode(mode);
                setSessionPickerOpen(false);
              }}
              onClose={() => setSessionPickerOpen(false)}
            />
          )}
        </div>

        {sessionMode.kind === "new" && baseBranch && (
          <span className={styles.baseHint}>
            from <strong>{baseBranch}</strong>
          </span>
        )}

        {knownModels.length > 0 && modelDisplayName && (
          <div ref={modelChipRef} className={styles.chipAnchor}>
            <Chip
              mono
              muted
              interactive
              title="Switch model"
              onClick={() => setModelPickerOpen((o) => !o)}
            >
              {modelDisplayName}
            </Chip>
            {modelPickerOpen && (
              <ModelPicker
                triggerRef={modelChipRef}
                currentModel={modelValue}
                models={knownModels}
                runner={runnerSelection}
                onClose={() => setModelPickerOpen(false)}
                onSelect={(m) => {
                  setModelPickerOpen(false);
                  setModelValue(m);
                }}
              />
            )}
          </div>
        )}

        <div ref={linkedChipRef} className={styles.chipAnchor}>
          <Chip
            interactive
            muted={linkedProjects.length === 0}
            selected={linkedPickerOpen}
            leading={<Icons.FolderIcon size={11} />}
            title={
              linkedProjects.length === 0
                ? "Link other project"
                : `${linkedProjects.length} project${linkedProjects.length === 1 ? "" : "s"} linked`
            }
            onClick={() => setLinkedPickerOpen((o) => !o)}
          >
            {linkedProjects.length === 0
              ? "Link"
              : `${linkedProjects.length} linked`}
          </Chip>
          {linkedPickerOpen && (
            <LauncherLinkedPopover
              triggerRef={linkedChipRef}
              projects={projects}
              selectedPaths={linkedProjects}
              excludePaths={project ? [project.path] : []}
              onToggle={toggleLinkedProject}
              onClose={() => setLinkedPickerOpen(false)}
            />
          )}
        </div>

        <div className={styles.spacer} />

        <Button variant="primary" type="submit" size="sm" disabled={!canSubmit}>
          {submitting ? "Starting…" : "Start"}
        </Button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <input
        ref={fileInputRef}
        accept={ACCEPTED_IMAGE_TYPES}
        className={styles.hiddenFileInput}
        multiple
        tabIndex={-1}
        type="file"
        onChange={handleFileSelect}
      />
    </form>
  );
}
