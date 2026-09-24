import type { DropProgress } from "../../../lib/droppedFiles";
import type { ImageAttachment } from "../../../lib/ipc";
import type { ProjectEntry, SlashCommand } from "../../../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  ChatInputShell,
  Chip,
  ContextMeter,
  FileMentionPicker,
  SlashCommandList,
  Icons,
  ImageAttachmentStrip,
  ProgressBar,
} from "@argus/peacock";
import { useCombinedRef } from "../../../hooks/useCombinedRef";
import { resolveDroppedFilePaths } from "../../../lib/droppedFiles";
import {
  ACCEPTED_IMAGE_TYPES,
  extractImageFilesFromClipboard,
  filesToPendingImages,
} from "../../../lib/imageAttachments";
import {
  listProjects,
  setAgentRunner,
  setSessionClaudeAccount,
} from "../../../lib/ipc";
import { buildLinkedProjectsPreamble } from "../../../lib/linkedProjectsPreamble";
import {
  type CanonicalPermissionMode,
  nextPermissionMode,
  permissionModeDisplayName,
  toCanonicalPermissionMode,
} from "../../../lib/permissionModes";
import { updateAgent } from "../../../stores/agentStore";
import { useClaudeAccounts } from "../../../stores/claudeAccountsStore";
import {
  clearDraft,
  getDraft,
  getLinkedProjects,
  getPendingImages,
  type PendingImage,
  setDraft,
  setLinkedProjects,
  setPendingImages,
  useLinkedProjects,
  usePendingImages,
} from "../../../stores/conversationStore";
import { openImageViewer } from "../../../stores/imageViewerStore";
import { pushError } from "../../../stores/notificationsStore";
import { useRegisteredRunners } from "../../../stores/runnersStore";
import { updateSession, useSessions } from "../../../stores/sessionStore";
import { DEFAULT_LLM_RUNNER } from "../../../stores/settingsStore";
import { EffortPicker, effortDisplayName } from "../EffortPicker";
import { useHuddleTyping } from "../HuddleShare";
import {
  type AccountSelection,
  type ModelOption,
  ModelPicker,
  type RunnerSelection,
} from "../ModelPicker";
import { PermissionModePicker } from "../PermissionModePicker";
import { ProjectPicker } from "../ProjectPicker";
import styles from "./ChatInput.module.css";
import { useMentionPicker } from "./useMentionPicker";

interface ChatInputProps {
  /** Agent ID — used to persist draft text across tab switches. */
  agentId?: string | null;
  /** Runner this agent is bound to. Falls back to the session's. */
  agentRunnerId?: string | null;
  agentStatus?:
    | "error"
    | "idle"
    | "requires_action"
    | "running"
    | "stopped"
    | null;
  /**
   * True while this agent's conversation is still empty — its runner is only
   * switchable up to the first message.
   */
  canSwitchRunner?: boolean;
  /** Max context-window size for the active model (tokens). */
  contextLimit?: number;
  /** Tokens currently resident in the model's context window. */
  contextTokens?: number;
  disabled?: boolean;
  disabledPlaceholder?: string;
  /** Current reasoning-effort level (e.g. "high"). `null`/undefined = model default. */
  effort?: string | null;
  model?: string;
  modelPickerOpen?: boolean;
  models?: ModelOption[];
  /** The model identifier used for matching in the picker (e.g. "default"). */
  modelValue?: string;
  onInterrupt?: () => void;
  onModelPickerOpenChange?: (open: boolean) => void;
  onModelSelect?: (model: string) => void;
  onSend: (message: string, images?: ImageAttachment[]) => void;
  /** Set the agent's effort level. Omit to hide the effort pill. */
  onSetEffort?: (level: string | null) => void;
  /**
   * Set the agent's permission mode. Omit to hide the picker (e.g. read-only
   * historical conversations).
   */
  onSetPermissionMode?: (mode: CanonicalPermissionMode) => void;
  /** Current permission mode in any vocabulary; normalised to canonical for display. */
  permissionMode?: string;
  sessionId?: string;
  slashCommands?: SlashCommand[];
  /** Effort levels the active model advertises in its capabilities. */
  supportedEffortLevels?: string[];
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

// Ghost-text argument hint for a value like "/model " — the completed command
// name plus a trailing space, before any argument is typed.
function argHintFor(
  value: string,
  commands: SlashCommand[] | undefined,
): { hint: string; text: string } | null {
  const match = /^\/(\S+)[ \t]$/.exec(value);
  const cmd = match
    ? commands?.find((c) => c.name.toLowerCase() === match[1].toLowerCase())
    : undefined;

  return cmd?.argumentHint ? { hint: cmd.argumentHint, text: value } : null;
}

export function ChatInput({
  onSend,
  onInterrupt,
  agentId,
  agentRunnerId,
  agentStatus,
  canSwitchRunner = false,
  contextTokens,
  contextLimit,
  disabled = false,
  disabledPlaceholder,
  slashCommands,
  model,
  models,
  modelValue,
  modelPickerOpen: controlledPickerOpen,
  onModelPickerOpenChange,
  onModelSelect,
  permissionMode,
  onSetPermissionMode,
  effort,
  supportedEffortLevels,
  onSetEffort,
  textareaRef: externalTextareaRef,
  sessionId,
}: ChatInputProps) {
  const canonicalMode = toCanonicalPermissionMode(permissionMode);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const combinedRef = useCombinedRef(textareaRef, externalTextareaRef);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<SlashCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Inline ghost hint shown after a completed slash command (e.g. "/model [model]").
  const [argHint, setArgHint] = useState<{ hint: string; text: string } | null>(
    null,
  );
  const projectChipRef = useRef<HTMLDivElement>(null);
  const modelChipRef = useRef<HTMLDivElement>(null);
  const permissionChipRef = useRef<HTMLDivElement>(null);
  const effortChipRef = useRef<HTMLDivElement>(null);
  const [internalPickerOpen, setInternalPickerOpen] = useState(false);
  const [permissionPickerOpen, setPermissionPickerOpen] = useState(false);
  const [effortPickerOpen, setEffortPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  /** Bytes moving to a host; null locally, where a drop is already a path. */
  const [uploadProgress, setUploadProgress] = useState<DropProgress | null>(
    null,
  );
  const linkedProjects = useLinkedProjects(agentId);
  const huddleTyping = useHuddleTyping(agentId);
  const sessions = useSessions();
  const currentSession = sessionId
    ? (sessions.find((s) => s.id === sessionId) ?? null)
    : null;
  const currentRepoRoot = currentSession?.repo_root ?? null;
  const registeredRunners = useRegisteredRunners();
  const runnerId =
    agentRunnerId ?? currentSession?.runner_id ?? DEFAULT_LLM_RUNNER;
  // The runner locks as soon as this agent's conversation starts — the
  // transcript belongs to the CLI and gateway that produced it. Siblings in
  // the same session keep their own.
  const runnerSelection: RunnerSelection = {
    currentId: runnerId,
    locked: !canSwitchRunner,
    available: registeredRunners,
    onSelect: (id) => {
      if (!agentId || id === runnerId) {
        return;
      }
      // Optimistic; rolled back if the backend refuses, so the picker can't
      // claim a runner the agent never switched to.
      updateAgent(agentId, { runner_id: id });
      setAgentRunner(agentId, id).catch((err) => {
        updateAgent(agentId, { runner_id: runnerId });
        pushError(String(err), "set_agent_runner");
      });
    },
  };
  // Pinning is only offered once a second account exists — with one account
  // there's nothing to switch between.
  const { accounts: claudeAccounts, activeId: activeClaudeAccountId } =
    useClaudeAccounts();
  const accountSelection: AccountSelection | undefined =
    sessionId && claudeAccounts.length > 1
      ? {
          activeId: activeClaudeAccountId,
          currentId: currentSession?.claude_account_id ?? null,
          available: claudeAccounts.map((a) => ({
            id: a.id,
            displayName: a.label || a.email || "Claude account",
            description: a.label && a.email ? a.email : a.org_name,
          })),
          onSelect: (accountId) => {
            // Optimistic: nothing re-broadcasts the session list on this write.
            updateSession(sessionId, { claude_account_id: accountId });
            setSessionClaudeAccount(sessionId, accountId).catch(() => {});
          },
        }
      : undefined;
  const pendingImages = usePendingImages(agentId);
  const updatePendingImages = useCallback(
    (updater: (prev: PendingImage[]) => PendingImage[]) => {
      if (!agentId) {
        return;
      }
      setPendingImages(agentId, updater(getPendingImages(agentId)));
    },
    [agentId],
  );
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

  useEffect(() => {
    if (!projectPickerOpen) {
      return;
    }
    let cancelled = false;
    listProjects()
      .then((result) => {
        if (!cancelled) {
          setProjects(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjects([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectPickerOpen]);

  const toggleLinkedProject = useCallback(
    (path: string) => {
      if (!agentId) {
        return;
      }
      const current = getLinkedProjects(agentId);
      const next = current.includes(path)
        ? current.filter((p) => p !== path)
        : [...current, path];
      setLinkedProjects(agentId, next);
    },
    [agentId],
  );

  const modelPickerOpen = controlledPickerOpen ?? internalPickerOpen;
  const setModelPickerOpen = (open: boolean) => {
    onModelPickerOpenChange?.(open);
    setInternalPickerOpen(open);
  };

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const updateArgHint = useCallback(() => {
    setArgHint(argHintFor(textareaRef.current?.value ?? "", slashCommands));
  }, [slashCommands]);

  // Recompute the hint from the restored draft when the agent tab changes,
  // during render so it never lags the (uncontrolled) textarea by a frame.
  const [hintAgentId, setHintAgentId] = useState(agentId);
  if (agentId !== hintAgentId) {
    setHintAgentId(agentId);
    setArgHint(argHintFor(agentId ? getDraft(agentId) : "", slashCommands));
  }

  // Restore draft when the agent tab changes (textarea is uncontrolled so we
  // seed its value directly).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.value = agentId ? getDraft(agentId) : "";
    adjustHeight();
  }, [agentId, adjustHeight]);

  const updateSuggestions = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !slashCommands?.length) {
      setSuggestions([]);

      return;
    }

    const val = el.value;
    if (val.startsWith("/") && !val.includes(" ") && !val.includes("\n")) {
      const query = val.slice(1).toLowerCase();
      const matches = slashCommands.filter((cmd) =>
        cmd.name.toLowerCase().includes(query),
      );
      setSuggestions(matches.slice(0, 8));
      setSelectedIndex(0);
    } else {
      setSuggestions([]);
    }
  }, [slashCommands]);

  const handleInput = useCallback(() => {
    adjustHeight();
    updateSuggestions();
    updateArgHint();
    updateMentions(textareaRef.current);
    huddleTyping.keystroke();
    if (agentId) {
      setDraft(agentId, textareaRef.current?.value ?? "");
    }
  }, [
    adjustHeight,
    updateSuggestions,
    updateArgHint,
    updateMentions,
    huddleTyping,
    agentId,
  ]);

  const submit = useCallback(() => {
    const value = textareaRef.current?.value.trim() ?? "";
    if ((!value && pendingImages.length === 0) || disabled) {
      return;
    }
    const images =
      pendingImages.length > 0
        ? pendingImages.map((p) => p.attachment)
        : undefined;

    const baseMessage = value || "(see attached images)";
    const messageWithContext = buildLinkedProjectsPreamble(
      linkedProjects,
      baseMessage,
    );

    onSend(messageWithContext, images);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      adjustHeight();
    }
    setArgHint(null);
    if (agentId) {
      clearDraft(agentId);
    }

    for (const img of pendingImages) {
      URL.revokeObjectURL(img.previewUrl);
    }

    if (agentId) {
      setPendingImages(agentId, []);
      setLinkedProjects(agentId, []);
    }
    setSuggestions([]);
    dismissMention();
    huddleTyping.stop();
  }, [
    onSend,
    disabled,
    adjustHeight,
    pendingImages,
    dismissMention,
    huddleTyping,
    agentId,
    linkedProjects,
  ]);

  const addImageFiles = useCallback(
    async (files: File[]) => {
      const newImages = await filesToPendingImages(files);
      if (newImages.length > 0) {
        updatePendingImages((prev) => [...prev, ...newImages]);
      }
    },
    [updatePendingImages],
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) {
        return;
      }
      await addImageFiles(Array.from(files));
      e.target.value = "";
      textareaRef.current?.focus();
    },
    [addImageFiles],
  );

  const insertFilePathMentions = useCallback(
    (paths: string[]) => {
      const el = textareaRef.current;
      if (!el || paths.length === 0) {
        return;
      }
      const cursor = el.selectionStart ?? el.value.length;
      const before = el.value.slice(0, cursor);
      const after = el.value.slice(cursor);
      const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
      const mentions = paths.map((p) => `@${p.replace(/ /g, "\\ ")}`).join(" ");
      const insertion = `${needsLeadingSpace ? " " : ""}${mentions} `;
      el.value = `${before}${insertion}${after}`;
      const newCursor = before.length + insertion.length;
      el.selectionStart = newCursor;
      el.selectionEnd = newCursor;
      el.focus();
      adjustHeight();
      if (agentId) {
        setDraft(agentId, el.value);
      }
    },
    [adjustHeight, agentId],
  );

  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
      return;
    }
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback(() => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) {
        return;
      }
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragOver(false);

      const imageFiles: File[] = [];
      const otherFiles: File[] = [];
      for (const file of Array.from(files)) {
        (file.type.startsWith("image/") ? imageFiles : otherFiles).push(file);
      }
      if (imageFiles.length > 0) {
        addImageFiles(imageFiles);
      }
      if (otherFiles.length === 0) {
        return;
      }
      // Attached to a host, the drop is uploaded before it can be mentioned.
      resolveDroppedFilePaths(sessionId, otherFiles, setUploadProgress)
        .then(({ paths, errors }) => {
          errors.forEach((message) => pushError(message, "attachment"));
          if (paths.length > 0) {
            insertFilePathMentions(paths);
          }
        })
        .catch((err: unknown) => pushError(String(err), "attachment"));
    },
    [addImageFiles, insertFilePathMentions, sessionId],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const imageFiles = extractImageFilesFromClipboard(e);
      if (imageFiles.length > 0) {
        e.preventDefault();
        addImageFiles(imageFiles);
      }
    },
    [addImageFiles],
  );

  const removeImage = useCallback(
    (index: number) => {
      updatePendingImages((prev) => {
        const removed = prev[index];
        if (removed) {
          URL.revokeObjectURL(removed.previewUrl);
        }

        return prev.filter((_, i) => i !== index);
      });
    },
    [updatePendingImages],
  );

  const applySuggestion = useCallback(
    (cmd: SlashCommand) => {
      if (!textareaRef.current) {
        return;
      }
      textareaRef.current.value = `/${cmd.name} `;
      textareaRef.current.focus();
      setSuggestions([]);
      adjustHeight();
      updateArgHint();
      if (agentId) {
        setDraft(agentId, textareaRef.current.value);
      }
    },
    [adjustHeight, updateArgHint, agentId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));

          return;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));

          return;
        }

        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          applySuggestion(suggestions[selectedIndex]);

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
            setMentionSelectedIndex((i) =>
              Math.min(i + 1, mentionItems.length - 1),
            );

            return;
          }

          if (e.key === "ArrowUp") {
            e.preventDefault();
            setMentionSelectedIndex((i) => Math.max(i - 1, 0));

            return;
          }

          if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
            e.preventDefault();
            selectMentionItem(textareaRef.current, mentionSelectedIndex);
            adjustHeight();

            return;
          }
        }

        if (e.key === "Escape") {
          e.preventDefault();
          dismissMention();

          return;
        }
      }

      if (e.key === "Tab" && e.shiftKey && onSetPermissionMode) {
        e.preventDefault();
        onSetPermissionMode(nextPermissionMode(canonicalMode));

        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [
      suggestions,
      selectedIndex,
      applySuggestion,
      submit,
      mentionContext,
      mentionItems,
      mentionSelectedIndex,
      setMentionSelectedIndex,
      selectMentionItem,
      dismissMention,
      adjustHeight,
      canonicalMode,
      onSetPermissionMode,
    ],
  );

  const above = (
    <>
      {uploadProgress && (
        <div className={styles.upload}>
          <span className={styles.uploadLabel}>
            {uploadProgress.count > 1
              ? `Uploading ${uploadProgress.name} (${String(uploadProgress.index)}/${String(uploadProgress.count)})`
              : `Uploading ${uploadProgress.name}`}
          </span>
          <ProgressBar
            aria-label={`Uploading ${uploadProgress.name}`}
            progress={
              uploadProgress.total > 0
                ? uploadProgress.transferred / uploadProgress.total
                : 0
            }
          />
        </div>
      )}
      <SlashCommandList
        items={suggestions}
        selectedIndex={selectedIndex}
        onSelect={(i) => applySuggestion(suggestions[i])}
        onSelectedIndexChange={setSelectedIndex}
      />

      {mentionContext && suggestions.length === 0 && (
        <FileMentionPicker
          headerText={mentionHeaderText}
          items={mentionItems}
          selectedIndex={mentionSelectedIndex}
          onSelect={(index) => {
            selectMentionItem(textareaRef.current, index);
            adjustHeight();
          }}
          onSelectedIndexChange={setMentionSelectedIndex}
        />
      )}

      <ImageAttachmentStrip
        scroll
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
            (cropped) => {
              updatePendingImages((prev) => {
                const target = prev[i];
                if (!target) {
                  return prev;
                }
                URL.revokeObjectURL(target.previewUrl);
                const next = [...prev];
                next[i] = {
                  name: target.name,
                  previewUrl: cropped.previewUrl,
                  attachment: {
                    data: cropped.data,
                    media_type: cropped.mediaType,
                  },
                };

                return next;
              });
            },
          );
        }}
        onRemove={removeImage}
      />
    </>
  );

  const actions = (
    <>
      {model && (
        <div ref={modelChipRef} className={styles.modelPickerAnchor}>
          <Chip
            mono
            muted
            interactive
            title={
              contextLimit && contextLimit > 0
                ? `Switch model — context: ${Math.round(
                    ((contextTokens ?? 0) / contextLimit) * 100,
                  )}% of ${contextLimit.toLocaleString()} tokens`
                : "Switch model"
            }
            leading={
              contextLimit && contextLimit > 0 ? (
                <ContextMeter
                  progress={(contextTokens ?? 0) / contextLimit}
                  size={12}
                  stroke={2}
                />
              ) : undefined
            }
            onClick={() => setModelPickerOpen(!modelPickerOpen)}
          >
            <ChatInputShell.CollapseLabel>{model}</ChatInputShell.CollapseLabel>
          </Chip>
          {modelPickerOpen && onModelSelect && models && models.length > 0 && (
            <ModelPicker
              triggerRef={modelChipRef}
              account={accountSelection}
              currentModel={modelValue ?? model}
              models={models}
              runner={runnerSelection}
              onClose={() => setModelPickerOpen(false)}
              onSelect={(m) => {
                setModelPickerOpen(false);
                onModelSelect(m);
              }}
            />
          )}
        </div>
      )}
      {onSetPermissionMode && (
        <div ref={permissionChipRef} className={styles.modelPickerAnchor}>
          <Chip
            interactive
            muted={canonicalMode === "auto"}
            className={
              canonicalMode === "auto" ? undefined : styles.planModeActive
            }
            aria-label="Switch permission mode"
            title={`Permission mode: ${permissionModeDisplayName(canonicalMode)} — click to switch (Shift+Tab to cycle)`}
            onClick={() => setPermissionPickerOpen((o) => !o)}
          >
            <ChatInputShell.CollapseLabel>
              {permissionModeDisplayName(canonicalMode)}
            </ChatInputShell.CollapseLabel>
          </Chip>
          {permissionPickerOpen && (
            <PermissionModePicker
              triggerRef={permissionChipRef}
              currentMode={canonicalMode}
              onClose={() => setPermissionPickerOpen(false)}
              onSelect={(m) => {
                setPermissionPickerOpen(false);
                onSetPermissionMode(m);
              }}
            />
          )}
        </div>
      )}
      {onSetEffort &&
        supportedEffortLevels &&
        supportedEffortLevels.length > 0 && (
          <div ref={effortChipRef} className={styles.modelPickerAnchor}>
            <Chip
              interactive
              muted={!effort}
              className={effort ? styles.planModeActive : undefined}
              aria-label="Switch reasoning effort"
              title={`Reasoning effort: ${effortDisplayName(effort)} — click to switch`}
              onClick={() => setEffortPickerOpen((o) => !o)}
            >
              <ChatInputShell.CollapseLabel>
                {effortDisplayName(effort)}
              </ChatInputShell.CollapseLabel>
            </Chip>
            {effortPickerOpen && (
              <EffortPicker
                triggerRef={effortChipRef}
                currentLevel={effort ?? null}
                supportedLevels={supportedEffortLevels}
                onClose={() => setEffortPickerOpen(false)}
                onSelect={(level) => {
                  setEffortPickerOpen(false);
                  onSetEffort(level);
                }}
              />
            )}
          </div>
        )}
      <div ref={projectChipRef} className={styles.modelPickerAnchor}>
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
          className={`${disabled ? styles.chipDisabled : ""} ${linkedProjects.length > 0 ? styles.planModeActive : ""}`}
          onClick={() => {
            if (disabled) {
              return;
            }
            setProjectPickerOpen((o) => !o);
          }}
        >
          <ChatInputShell.CollapseLabel>
            {linkedProjects.length === 0
              ? "Link other project"
              : `${linkedProjects.length} linked`}
          </ChatInputShell.CollapseLabel>
        </Chip>
        {projectPickerOpen && (
          <ProjectPicker
            triggerRef={projectChipRef}
            projects={projects}
            selectedPaths={linkedProjects}
            excludePaths={currentRepoRoot ? [currentRepoRoot] : []}
            onToggle={toggleLinkedProject}
            onClose={() => setProjectPickerOpen(false)}
          />
        )}
      </div>
    </>
  );

  const trailing = (
    <>
      <button
        aria-label="Attach image"
        className={styles.toolbarBtn}
        disabled={disabled}
        title="Attach image"
        onClick={() => fileInputRef.current?.click()}
      >
        <Icons.PaperclipIcon />
      </button>
      {agentStatus === "running" && onInterrupt ? (
        <Button
          variant="stop"
          aria-label="Stop agent"
          title="Stop"
          onClick={onInterrupt}
        >
          <Icons.StopIcon />
        </Button>
      ) : (
        <Button
          variant="send"
          aria-label="Send message"
          disabled={disabled}
          title="Send"
          onClick={submit}
        >
          <Icons.SendIcon />
        </Button>
      )}
    </>
  );

  return (
    <ChatInputShell
      className={styles.shell}
      disabled={disabled}
      dragOver={isDragOver}
      above={above}
      actions={actions}
      trailing={trailing}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className={styles.textareaWrap}>
        <textarea
          ref={combinedRef}
          aria-label="Message the agent"
          className={styles.textarea}
          disabled={disabled}
          placeholder={
            disabled
              ? (disabledPlaceholder ?? "Agent is not running")
              : "Message the agent… (Enter to send, / for commands, @ for files)"
          }
          rows={1}
          onBlur={() => setIsFocused(false)}
          onClick={() => {
            if (suggestions.length > 0) {
              setSuggestions([]);
            }
          }}
          onFocus={() => setIsFocused(true)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onSelect={() => updateMentions(textareaRef.current)}
        />
        {argHint && !disabled && (
          <div className={styles.argHint} aria-hidden="true">
            <span className={styles.argHintSpacer}>{argHint.text}</span>
            <span className={styles.argHintText}>{argHint.hint}</span>
          </div>
        )}
        {!isFocused &&
          !disabled &&
          suggestions.length === 0 &&
          !modelPickerOpen && (
            <span className={styles.focusHint}>
              {navigator.platform?.includes("Mac") ? "⌘" : "Ctrl+"}L to focus
            </span>
          )}
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
    </ChatInputShell>
  );
}
