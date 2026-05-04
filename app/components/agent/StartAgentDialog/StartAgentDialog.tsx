import type { ProjectEntry, SlashCommand } from "../../../lib/types";
import type { PendingImage } from "../../../stores/conversationStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Chip,
  Icons,
  ImageAttachmentStrip,
  TextArea,
} from "@argus/peacock";
import {
  sendUserMessageToAgent,
  startAgentInSession,
} from "../../../lib/agentLifecycle";
import {
  ACCEPTED_IMAGE_TYPES,
  extractImageFilesFromClipboard,
  filesToPendingImages,
} from "../../../lib/imageAttachments";
import { listProjects } from "../../../lib/ipc";
import { getLastKnownCapabilities } from "../../../lib/lastKnownCapabilities";
import { buildLinkedProjectsPreamble } from "../../../lib/linkedProjectsPreamble";
import {
  type CanonicalPermissionMode,
  permissionModeDisplayName,
} from "../../../lib/permissionModes";
import { openImageViewer } from "../../../stores/imageViewerStore";
import { pushError } from "../../../stores/notificationsStore";
import { usePrewarmSlot } from "../../../stores/prewarmStore";
import { useRegisteredRunners } from "../../../stores/runnersStore";
import { useSessions } from "../../../stores/sessionStore";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";
import { FileMentionPicker } from "../../shared/FileMentionPicker";
import { useMentionPicker } from "../ChatInput/useMentionPicker";
import { ModelPicker, type RunnerSelection } from "../ModelPicker";
import { PermissionModePicker } from "../PermissionModePicker";
import { ProjectPicker } from "../ProjectPicker";
import dialogExtra from "./StartAgentDialog.module.css";

interface StartAgentDialogProps {
  /** Initial permission mode the dialog opens with. Defaults to `"auto"`. */
  initialMode?: CanonicalPermissionMode;
  /** Initial prompt the dialog opens with. */
  initialPrompt?: string;
  onClose: () => void;
  /** Notified whenever the prompt changes — lets callers keep their own
   *  composer in sync with the dialog. */
  onPromptChange?: (prompt: string) => void;
  sessionId: string;
}

const MODE_BLURBS: Record<CanonicalPermissionMode, string> = {
  auto: "Describe what the agent should work on.",
  plan: "The agent must present a plan for approval before any writes.",
  review: "File edits are auto-approved; shell + network still ask.",
  trusted: "Every tool call is auto-approved. Use with caution.",
};

function buildMessage(prompt: string, linkedProjects: string[]): string {
  return buildLinkedProjectsPreamble(
    linkedProjects,
    prompt.trim() || "(see attached images)",
  );
}

export function StartAgentDialog({
  sessionId,
  initialMode = "auto",
  initialPrompt = "",
  onClose,
  onPromptChange,
}: StartAgentDialogProps) {
  const [permissionMode, setPermissionMode] =
    useState<CanonicalPermissionMode>(initialMode);
  const [permissionPickerOpen, setPermissionPickerOpen] = useState(false);
  const permissionChipRef = useRef<HTMLDivElement>(null);
  // Prefer capabilities from the prewarmed Claude subprocess for this
  // session — those are guaranteed to match the CLI we're about to claim.
  // Fall back to whatever the most recent conversation reported (or the
  // localStorage cache) when prewarm is still spawning or has failed.
  const prewarmSlot = usePrewarmSlot(sessionId);
  const cached = useMemo(() => getLastKnownCapabilities(), []);
  const knownModels =
    prewarmSlot?.models.length && prewarmSlot.models.length > 0
      ? prewarmSlot.models
      : cached.models;
  const slashCommands =
    prewarmSlot?.slashCommands.length && prewarmSlot.slashCommands.length > 0
      ? prewarmSlot.slashCommands
      : cached.slashCommands;

  const [prompt, setPrompt] = useState(initialPrompt);
  const updatePrompt = useCallback(
    (next: string) => {
      setPrompt(next);
      onPromptChange?.(next);
    },
    [onPromptChange],
  );
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [linkedProjects, setLinkedProjects] = useState<string[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectEntry[]>([]);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [modelValue, setModelValue] = useState<string>("default");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  // The runner is locked to whatever this session was created with —
  // Resolved Decision 4 of the LLM-routing plan.
  const sessions = useSessions();
  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const registeredRunners = useRegisteredRunners();
  const runnerSelection: RunnerSelection = {
    currentId: session?.runner_id ?? "claude-code",
    locked: true,
    available: registeredRunners,
  };
  const [suggestions, setSuggestions] = useState<SlashCommand[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const modelChipRef = useRef<HTMLDivElement>(null);
  const projectChipRef = useRef<HTMLDivElement>(null);

  const {
    mentionContext,
    items: mentionItems,
    selectedIndex: mentionSelectedIndex,
    setSelectedIndex: setMentionSelectedIndex,
    updateMentions,
    selectItem: selectMentionItem,
    dismissMention,
    headerText: mentionHeaderText,
  } = useMentionPicker(sessionId);

  // Revoke object URLs when unmounting so previews don't leak.
  useEffect(() => {
    return () => {
      for (const img of pendingImages) {
        URL.revokeObjectURL(img.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy-load the projects list when the project picker opens.
  useEffect(() => {
    if (!projectPickerOpen) {
      return;
    }
    let cancelled = false;
    listProjects()
      .then((result) => {
        if (!cancelled) {
          setAllProjects(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllProjects([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectPickerOpen]);

  const toggleLinkedProject = useCallback((path: string) => {
    setLinkedProjects((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  }, []);

  const modelDisplayName = useMemo(() => {
    if (!knownModels.length) {
      return undefined;
    }
    const match = knownModels.find((m) => m.value === modelValue);

    return match?.displayName ?? knownModels[0]?.displayName;
  }, [knownModels, modelValue]);

  const updateSuggestions = useCallback(
    (value: string) => {
      if (!slashCommands.length) {
        setSuggestions([]);

        return;
      }
      if (
        value.startsWith("/") &&
        !value.includes(" ") &&
        !value.includes("\n")
      ) {
        const query = value.slice(1).toLowerCase();
        setSuggestions(
          slashCommands
            .filter((c) => c.name.toLowerCase().includes(query))
            .slice(0, 8),
        );
        setSuggestionIndex(0);
      } else {
        setSuggestions([]);
      }
    },
    [slashCommands],
  );

  const applySuggestion = useCallback(
    (cmd: SlashCommand) => {
      const next = `/${cmd.name} `;
      updatePrompt(next);
      setSuggestions([]);
      promptRef.current?.focus();
    },
    [updatePrompt],
  );

  const handlePromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      updatePrompt(next);
      updateSuggestions(next);
      updateMentions(promptRef.current);
    },
    [updateSuggestions, updateMentions, updatePrompt],
  );

  const insertFilePathMentions = useCallback(
    (paths: string[]) => {
      const el = promptRef.current;
      if (!el || paths.length === 0) {
        return;
      }
      const cursor = el.selectionStart ?? el.value.length;
      const before = el.value.slice(0, cursor);
      const after = el.value.slice(cursor);
      const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
      const mentions = paths.map((p) => `@${p}`).join(" ");
      const insertion = `${needsLeadingSpace ? " " : ""}${mentions} `;
      const next = `${before}${insertion}${after}`;
      updatePrompt(next);
      requestAnimationFrame(() => {
        const node = promptRef.current;
        if (!node) {
          return;
        }
        const newCursor = before.length + insertion.length;
        node.selectionStart = newCursor;
        node.selectionEnd = newCursor;
        node.focus();
      });
    },
    [updatePrompt],
  );

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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) {
        return;
      }
      e.preventDefault();
      const paths: string[] = [];
      for (const file of Array.from(files)) {
        const p = window.argus.getFilePath?.(file) ?? "";
        if (p) {
          paths.push(p);
        }
      }
      if (paths.length > 0) {
        insertFilePathMentions(paths);
      }
    },
    [insertFilePathMentions],
  );

  const trimmedPrompt = prompt.trim();
  const canSubmit =
    (trimmedPrompt.length > 0 || pendingImages.length > 0) && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    const images = pendingImages.map((p) => p.attachment);
    const message = buildMessage(prompt, linkedProjects);
    onClose();
    try {
      const info = await startAgentInSession(sessionId, {
        focus: true,
        model: modelValue !== "default" ? modelValue : undefined,
        permissionMode: permissionMode === "auto" ? undefined : permissionMode,
      });
      await sendUserMessageToAgent(
        info.agent_id,
        message,
        images.length > 0 ? images : undefined,
        { assumeIdle: true },
      );
    } catch (err) {
      pushError(
        err instanceof Error ? err.message : String(err),
        "start_agent",
      );
    }
  }, [
    canSubmit,
    linkedProjects,
    permissionMode,
    modelValue,
    onClose,
    pendingImages,
    prompt,
    sessionId,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSuggestionIndex((i) => Math.min(i + 1, suggestions.length - 1));

          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSuggestionIndex((i) => Math.max(i - 1, 0));

          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          applySuggestion(suggestions[suggestionIndex]);

          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSuggestions([]);

          return;
        }
      }

      if (mentionContext) {
        if (mentionItems.length > 0) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setMentionSelectedIndex((i: number) =>
              Math.min(i + 1, mentionItems.length - 1),
            );

            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setMentionSelectedIndex((i: number) => Math.max(i - 1, 0));

            return;
          }
          if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
            e.preventDefault();
            selectMentionItem(promptRef.current, mentionSelectedIndex);

            return;
          }
        }
        if (e.key === "Escape") {
          e.preventDefault();
          dismissMention();

          return;
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [
      applySuggestion,
      canSubmit,
      dismissMention,
      handleSubmit,
      mentionContext,
      mentionItems.length,
      mentionSelectedIndex,
      selectMentionItem,
      setMentionSelectedIndex,
      suggestionIndex,
      suggestions,
    ],
  );

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  const title =
    permissionMode === "auto"
      ? "Start agent"
      : `Start agent (${permissionModeDisplayName(permissionMode)})`;

  const modeBlurb = MODE_BLURBS[permissionMode];

  return (
    <Dialog
      size="medium"
      title={title}
      titleId="start-agent-title"
      onClose={onClose}
    >
      <form className={styles.form} onSubmit={onFormSubmit}>
        <p className={styles.bodyText}>{modeBlurb}</p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="start-agent-prompt">
            Prompt{" "}
            <span className={styles.labelHint}>
              (Enter to send · / for commands · @ for files)
            </span>
          </label>

          <div
            className={dialogExtra.promptStack}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {suggestions.length > 0 && (
              <div className={dialogExtra.suggestions}>
                <div className={dialogExtra.suggestionsHeader}>Commands</div>
                {suggestions.map((cmd, i) => (
                  <button
                    key={cmd.name}
                    className={`${dialogExtra.suggestion} ${
                      i === suggestionIndex ? dialogExtra.suggestionActive : ""
                    }`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applySuggestion(cmd);
                    }}
                    onMouseEnter={() => setSuggestionIndex(i)}
                  >
                    <span className={dialogExtra.suggestionSlash}>/</span>
                    <span className={dialogExtra.suggestionName}>
                      {cmd.name}
                    </span>
                    {cmd.description && (
                      <span className={dialogExtra.suggestionDesc}>
                        {cmd.description}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {mentionContext && suggestions.length === 0 && (
              <FileMentionPicker
                headerText={mentionHeaderText}
                items={mentionItems}
                selectedIndex={mentionSelectedIndex}
                onSelect={(index) =>
                  selectMentionItem(promptRef.current, index)
                }
                onSelectedIndexChange={setMentionSelectedIndex}
              />
            )}

            <div className={styles.promptWrap}>
              <TextArea
                ref={promptRef}
                autoFocus
                id="start-agent-prompt"
                placeholder="What should the agent work on?"
                rows={5}
                value={prompt}
                onChange={handlePromptChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePromptPaste}
                onSelect={() => updateMentions(promptRef.current)}
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

          <div className={styles.promptChips}>
            <div ref={permissionChipRef} className={styles.chipAnchor}>
              <Chip
                interactive
                muted={permissionMode === "auto"}
                aria-label="Switch permission mode"
                title={`Permission mode: ${permissionModeDisplayName(permissionMode)}`}
                onClick={() => setPermissionPickerOpen((o) => !o)}
              >
                {permissionModeDisplayName(permissionMode)}
              </Chip>
              {permissionPickerOpen && (
                <PermissionModePicker
                  triggerRef={permissionChipRef}
                  currentMode={permissionMode}
                  onClose={() => setPermissionPickerOpen(false)}
                  onSelect={(m) => {
                    setPermissionPickerOpen(false);
                    setPermissionMode(m);
                  }}
                />
              )}
            </div>
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
            <div ref={projectChipRef} className={styles.chipAnchor}>
              <Chip
                interactive
                muted={linkedProjects.length === 0}
                aria-label="Link other project"
                title={
                  linkedProjects.length === 0
                    ? "Link other project"
                    : `${linkedProjects.length} project${linkedProjects.length === 1 ? "" : "s"} linked`
                }
                leading={<Icons.FolderIcon size={11} />}
                onClick={() => setProjectPickerOpen((o) => !o)}
              >
                {linkedProjects.length === 0
                  ? "Link other project"
                  : `${linkedProjects.length} linked`}
              </Chip>
              {projectPickerOpen && (
                <ProjectPicker
                  triggerRef={projectChipRef}
                  projects={allProjects}
                  selectedPaths={linkedProjects}
                  onToggle={toggleLinkedProject}
                  onClose={() => setProjectPickerOpen(false)}
                />
              )}
            </div>
          </div>

          <input
            ref={fileInputRef}
            accept={ACCEPTED_IMAGE_TYPES}
            className={styles.hiddenFileInput}
            multiple
            tabIndex={-1}
            type="file"
            onChange={handleFileSelect}
          />
        </div>

        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSubmit} type="submit">
            {permissionMode === "auto"
              ? "Start agent"
              : `Start in ${permissionModeDisplayName(permissionMode).toLowerCase()} mode`}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
