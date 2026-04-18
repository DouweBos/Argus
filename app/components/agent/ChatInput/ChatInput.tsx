import type { ImageAttachment } from "../../../lib/ipc";
import type { SlashCommand } from "../../../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Chip, Icons } from "@argus/peacock";
import { useCombinedRef } from "../../../hooks/useCombinedRef";
import {
  clearDraft,
  getDraft,
  getPendingImages,
  type PendingImage,
  setDraft,
  setPendingImages,
  usePendingImages,
} from "../../../stores/conversationStore";
import { openImageViewer } from "../../../stores/imageViewerStore";
import { FileMentionPicker } from "../FileMentionPicker";
import { type ModelOption, ModelPicker } from "../ModelPicker";
import styles from "./ChatInput.module.css";
import { useMentionPicker } from "./useMentionPicker";

const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";

interface ChatInputProps {
  /** Agent ID — used to persist draft text across tab switches. */
  agentId?: string | null;
  agentStatus?: "error" | "idle" | "running" | "stopped" | null;
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
  slashCommands?: SlashCommand[];
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  workspaceId?: string;
}

/** Read a File as base64 (without the data-URL prefix). */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip "data:<type>;base64," prefix
      resolve(result.split(",")[1]);
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ChatInput({
  onSend,
  onInterrupt,
  agentId,
  agentStatus,
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
  workspaceId,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const combinedRef = useCombinedRef(textareaRef, externalTextareaRef);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<SlashCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const [internalPickerOpen, setInternalPickerOpen] = useState(false);
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
  } = useMentionPicker(workspaceId);

  // Model picker: controlled from parent if props provided, otherwise internal.
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
    // Only show suggestions when the input starts with "/" and is a single token
    if (val.startsWith("/") && !val.includes(" ") && !val.includes("\n")) {
      const query = val.slice(1).toLowerCase();
      const matches = slashCommands.filter((cmd) =>
        cmd.name.toLowerCase().startsWith(query),
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
    onSend(value || "(see attached images)", images);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      adjustHeight();
    }
    if (agentId) {
      clearDraft(agentId);
    }

    // Revoke object URLs to free memory
    for (const img of pendingImages) {
      URL.revokeObjectURL(img.previewUrl);
    }

    if (agentId) {
      setPendingImages(agentId, []);
    }
    setSuggestions([]);
    dismissMention();
  }, [onSend, disabled, adjustHeight, pendingImages, dismissMention, agentId]);

  const addImageFiles = useCallback(
    async (files: File[]) => {
      const newImages: PendingImage[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          continue;
        }
        const data = await readFileAsBase64(file);
        newImages.push({
          name: file.name || "pasted-image",
          previewUrl: URL.createObjectURL(file),
          attachment: { data, media_type: file.type },
        });
      }

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
      // Reset file input so the same file can be re-selected
      e.target.value = "";
      textareaRef.current?.focus();
    },
    [addImageFiles],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) {
        return;
      }
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        addImageFiles(imageFiles);
      }
      // If no images, let the default paste (text) happen
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

  // Scroll selected suggestion into view
  useEffect(() => {
    const container = suggestionsRef.current;
    if (!container) {
      return;
    }
    // +1 to skip the header element at children[0]
    const selected = container.children[selectedIndex + 1] as HTMLElement;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div className={styles.wrapper}>
      <div
        className={`${styles.container} ${disabled ? styles.containerDisabled : ""}`}
      >
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
                  <span className={styles.suggestionDesc}>
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
            onSelect={(index) => {
              selectMentionItem(textareaRef.current, index);
              adjustHeight();
            }}
            onSelectedIndexChange={setMentionSelectedIndex}
          />
        )}

        {pendingImages.length > 0 && (
          <div className={styles.attachments}>
            {pendingImages.map((img, i) => (
              <div key={img.name + i} className={styles.attachmentThumb}>
                <button
                  className={styles.attachmentPreviewBtn}
                  title={img.name}
                  type="button"
                  onClick={() =>
                    openImageViewer(
                      `data:${img.attachment.media_type};base64,${img.attachment.data}`,
                      img.name,
                      img.previewUrl,
                    )
                  }
                >
                  <img
                    alt={img.name}
                    className={styles.attachmentImg}
                    src={img.previewUrl}
                  />
                </button>
                <button
                  aria-label={`Remove ${img.name}`}
                  className={styles.attachmentRemove}
                  title="Remove"
                  onClick={() => removeImage(i)}
                >
                  <Icons.CloseIcon size={8} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={styles.textareaWrap}>
          <textarea
            ref={combinedRef}
            aria-label="Message the agent"
            className={styles.textarea}
            disabled={disabled}
            placeholder={
              disabled
                ? (disabledPlaceholder ?? "Agent is not running")
                : "Message the agent\u2026 (Enter to send, / for commands, @ for files)"
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
                {navigator.platform?.includes("Mac") ? "\u2318" : "Ctrl+"}L to
                focus
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

        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            {model && (
              <div className={styles.modelPickerAnchor}>
                <Chip
                  mono
                  muted
                  interactive
                  title="Switch model"
                  onClick={() => setModelPickerOpen(!modelPickerOpen)}
                >
                  {model}
                </Chip>
                {modelPickerOpen &&
                  onModelSelect &&
                  models &&
                  models.length > 0 && (
                    <ModelPicker
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
            <Chip
              interactive
              muted
              aria-label="Link Linear issue"
              title="Link Linear issue"
              leading={<Icons.LinearIcon size={11} />}
              className={disabled ? styles.chipDisabled : undefined}
              onClick={() => {
                if (disabled || !textareaRef.current) {
                  return;
                }
                // Insert /linear command to trigger the slash command flow
                textareaRef.current.value = "/linear ";
                textareaRef.current.focus();
                adjustHeight();
                updateSuggestions();
              }}
            >
              Link issue
            </Chip>
          </div>
          <div className={styles.toolbarRight}>
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
          </div>
        </div>
      </div>
    </div>
  );
}
