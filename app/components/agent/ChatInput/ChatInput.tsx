import type { ImageAttachment } from "../../../lib/ipc";
import type { ProjectEntry, SlashCommand } from "../../../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  ChatInputShell,
  Chip,
  ContextMeter,
  Icons,
  ImageAttachmentStrip,
} from "@argus/peacock";
import { useCombinedRef } from "../../../hooks/useCombinedRef";
import {
  ACCEPTED_IMAGE_TYPES,
  extractImageFilesFromClipboard,
  filesToPendingImages,
} from "../../../lib/imageAttachments";
import { listProjects } from "../../../lib/ipc";
import { buildLinkedProjectsPreamble } from "../../../lib/linkedProjectsPreamble";
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
import { useSessions } from "../../../stores/sessionStore";
import { FileMentionPicker } from "../../shared/FileMentionPicker";
import { type ModelOption, ModelPicker } from "../ModelPicker";
import { ProjectPicker } from "../ProjectPicker";
import styles from "./ChatInput.module.css";
import { useMentionPicker } from "./useMentionPicker";

interface ChatInputProps {
  /** Agent ID — used to persist draft text across tab switches. */
  agentId?: string | null;
  agentStatus?:
    | "error"
    | "idle"
    | "requires_action"
    | "running"
    | "stopped"
    | null;
  /** Max context-window size for the active model (tokens). */
  contextLimit?: number;
  /** Tokens currently resident in the model's context window. */
  contextTokens?: number;
  disabled?: boolean;
  disabledPlaceholder?: string;
  model?: string;
  modelPickerOpen?: boolean;
  models?: ModelOption[];
  /** The model identifier used for matching in the picker (e.g. "default"). */
  modelValue?: string;
  onInterrupt?: () => void;
  onModelPickerOpenChange?: (open: boolean) => void;
  onModelSelect?: (model: string) => void;
  onSend: (message: string, images?: ImageAttachment[]) => void;
  onTogglePlanMode?: () => void;
  planMode?: boolean;
  sessionId?: string;
  slashCommands?: SlashCommand[];
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function ChatInput({
  onSend,
  onInterrupt,
  agentId,
  agentStatus,
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
  planMode = false,
  onTogglePlanMode,
  textareaRef: externalTextareaRef,
  sessionId,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const combinedRef = useCombinedRef(textareaRef, externalTextareaRef);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<SlashCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const projectChipRef = useRef<HTMLDivElement>(null);
  const modelChipRef = useRef<HTMLDivElement>(null);
  const [internalPickerOpen, setInternalPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const linkedProjects = useLinkedProjects(agentId);
  const sessions = useSessions();
  const currentRepoRoot = sessionId
    ? (sessions.find((s) => s.id === sessionId)?.repo_root ?? null)
    : null;
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
    updateMentions(textareaRef.current);
    if (agentId) {
      setDraft(agentId, textareaRef.current?.value ?? "");
    }
  }, [adjustHeight, updateSuggestions, updateMentions, agentId]);

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
  }, [
    onSend,
    disabled,
    adjustHeight,
    pendingImages,
    dismissMention,
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
      const mentions = paths.map((p) => `@${p}`).join(" ");
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
      if (agentId) {
        setDraft(agentId, textareaRef.current.value);
      }
    },
    [adjustHeight, agentId],
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
    ],
  );

  useEffect(() => {
    const container = suggestionsRef.current;
    if (!container) {
      return;
    }
    const selected = container.children[selectedIndex + 1] as HTMLElement;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const above = (
    <>
      {suggestions.length > 0 && (
        <div ref={suggestionsRef} className={styles.suggestions}>
          <div className={styles.suggestionsHeader}>Commands</div>
          {suggestions.map((cmd, i) => (
            <button
              key={cmd.name}
              className={`${styles.suggestion} ${i === selectedIndex ? styles.suggestionActive : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(cmd);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className={styles.suggestionSlash}>/</span>
              <span className={styles.suggestionName}>{cmd.name}</span>
              {cmd.description && (
                <span className={styles.suggestionDesc}>{cmd.description}</span>
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
              currentModel={modelValue ?? model}
              models={models}
              onClose={() => setModelPickerOpen(false)}
              onSelect={(m) => {
                setModelPickerOpen(false);
                onModelSelect(m);
              }}
            />
          )}
        </div>
      )}
      {onTogglePlanMode && (
        <Chip
          interactive
          muted={!planMode}
          className={planMode ? styles.planModeActive : undefined}
          aria-label="Toggle plan mode"
          title={
            planMode
              ? "Plan mode on — click to disable (restarts agent)"
              : "Enable plan mode (restarts agent)"
          }
          onClick={onTogglePlanMode}
        >
          Plan
        </Chip>
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
