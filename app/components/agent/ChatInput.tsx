import { useRef, useCallback, useState, useEffect } from "react";
import type { ImageAttachment } from "../../lib/ipc";
import { useCombinedRef } from "../../hooks/useCombinedRef";
import { ModelPicker } from "./ModelPicker";
import {
  SendIcon,
  StopIcon,
  PaperclipIcon,
  CloseIcon,
  LinearIcon,
} from "../shared/Icons";
import styles from "./ChatInput.module.css";

const AVAILABLE_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
];

const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";

interface PendingImage {
  attachment: ImageAttachment;
  name: string;
  previewUrl: string;
}

interface ChatInputProps {
  agentStatus?: "error" | "idle" | "running" | "stopped" | null;
  costStr?: null | string;
  disabled?: boolean;
  disabledPlaceholder?: string;
  durationStr?: null | string;
  model?: string;
  onInterrupt?: () => void;
  onModelSelect?: (model: string) => void;
  onSend: (message: string, images?: ImageAttachment[]) => void;
  onTogglePlanMode?: () => void;
  planMode?: boolean;
  slashCommands?: string[];
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
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
  agentStatus,
  disabled = false,
  disabledPlaceholder,
  slashCommands,
  model,
  durationStr,
  costStr,
  onModelSelect,
  planMode = false,
  onTogglePlanMode,
  textareaRef: externalTextareaRef,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const combinedRef = useCombinedRef(textareaRef, externalTextareaRef);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

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
        cmd.toLowerCase().startsWith(query),
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
  }, [adjustHeight, updateSuggestions]);

  const submit = useCallback(() => {
    const value = textareaRef.current?.value.trim() ?? "";
    if ((!value && pendingImages.length === 0) || disabled) return;
    const images =
      pendingImages.length > 0
        ? pendingImages.map((p) => p.attachment)
        : undefined;
    onSend(value || "(see attached images)", images);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      adjustHeight();
    }
    // Revoke object URLs to free memory
    for (const img of pendingImages) {
      URL.revokeObjectURL(img.previewUrl);
    }
    setPendingImages([]);
    setSuggestions([]);
  }, [onSend, disabled, adjustHeight, pendingImages]);

  const addImageFiles = useCallback(async (files: File[]) => {
    const newImages: PendingImage[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const data = await readFileAsBase64(file);
      newImages.push({
        name: file.name || "pasted-image",
        previewUrl: URL.createObjectURL(file),
        attachment: { data, media_type: file.type },
      });
    }
    if (newImages.length > 0) {
      setPendingImages((prev) => [...prev, ...newImages]);
    }
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
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
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
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

  const removeImage = useCallback((index: number) => {
    setPendingImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const applySuggestion = useCallback(
    (cmd: string) => {
      if (!textareaRef.current) return;
      textareaRef.current.value = `/${cmd} `;
      textareaRef.current.focus();
      setSuggestions([]);
      adjustHeight();
    },
    [adjustHeight],
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

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [suggestions, selectedIndex, applySuggestion, submit],
  );

  // Scroll selected suggestion into view
  useEffect(() => {
    const container = suggestionsRef.current;
    if (!container) return;
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
          <div className={styles.suggestions} ref={suggestionsRef}>
            <div className={styles.suggestionsHeader}>Commands</div>
            {suggestions.map((cmd, i) => (
              <button
                key={cmd}
                className={`${styles.suggestion} ${i === selectedIndex ? styles.suggestionActive : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySuggestion(cmd);
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className={styles.suggestionSlash}>/</span>
                <span className={styles.suggestionName}>{cmd}</span>
              </button>
            ))}
          </div>
        )}

        {pendingImages.length > 0 && (
          <div className={styles.attachments}>
            {pendingImages.map((img, i) => (
              <div key={img.name + i} className={styles.attachmentThumb}>
                <img
                  src={img.previewUrl}
                  alt={img.name}
                  className={styles.attachmentImg}
                />
                <button
                  className={styles.attachmentRemove}
                  onClick={() => removeImage(i)}
                  title="Remove"
                  aria-label={`Remove ${img.name}`}
                >
                  <CloseIcon size={8} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={styles.textareaWrap}>
          <textarea
            ref={combinedRef}
            className={styles.textarea}
            placeholder={
              disabled
                ? (disabledPlaceholder ?? "Agent is not running")
                : "Message the agent\u2026 (Enter to send, / for commands)"
            }
            rows={1}
            disabled={disabled}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onClick={() => {
              if (suggestions.length > 0) setSuggestions([]);
            }}
            aria-label="Message the agent"
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
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          multiple
          className={styles.hiddenFileInput}
          onChange={handleFileSelect}
          tabIndex={-1}
        />

        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            {model && (
              <div className={styles.modelPickerAnchor}>
                <button
                  className={styles.modelBadge}
                  onClick={() => setModelPickerOpen((o) => !o)}
                  title="Switch model"
                >
                  {model}
                </button>
                {modelPickerOpen && onModelSelect && (
                  <ModelPicker
                    models={AVAILABLE_MODELS}
                    currentModel={model}
                    onSelect={(m) => {
                      setModelPickerOpen(false);
                      onModelSelect(m);
                    }}
                    onClose={() => setModelPickerOpen(false)}
                  />
                )}
              </div>
            )}
            {onTogglePlanMode && (
              <button
                className={`${styles.planModeBtn} ${planMode ? styles.planModeActive : ""}`}
                title={
                  planMode
                    ? "Plan mode on — click to disable (restarts agent)"
                    : "Enable plan mode (restarts agent)"
                }
                aria-label="Toggle plan mode"
                onClick={onTogglePlanMode}
              >
                Plan
              </button>
            )}
            <button
              className={styles.linkIssueBtn}
              title="Link Linear issue"
              aria-label="Link Linear issue"
              disabled={disabled}
              onClick={() => {
                if (!textareaRef.current) return;
                // Insert /linear command to trigger the slash command flow
                textareaRef.current.value = "/linear ";
                textareaRef.current.focus();
                adjustHeight();
                updateSuggestions();
              }}
            >
              <LinearIcon />
              <span>Link issue</span>
            </button>
          </div>
          <div className={styles.toolbarRight}>
            <button
              className={styles.toolbarBtn}
              title="Attach image"
              aria-label="Attach image"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon />
            </button>
            {agentStatus === "running" && onInterrupt ? (
              <button
                className={`${styles.sendBtn} ${styles.stopBtn}`}
                onClick={onInterrupt}
                aria-label="Stop agent"
                title="Stop"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                className={styles.sendBtn}
                onClick={submit}
                disabled={disabled}
                aria-label="Send message"
                title="Send"
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.statusRow}>
        {agentStatus && (
          <span
            className={`${styles.statusIndicator} ${agentStatus === "running" ? styles.statusRunning : agentStatus === "idle" ? styles.statusIdle : styles.statusStopped}`}
          >
            <span className={styles.statusDot} />
            {agentStatus === "running"
              ? "Thinking"
              : agentStatus === "idle"
                ? "Idle"
                : "Stopped"}
          </span>
        )}
        <span className={styles.statusSpacer} />
        {durationStr && (
          <span className={styles.statusItem}>{durationStr}</span>
        )}
        {costStr && <span className={styles.statusItem}>{costStr}</span>}
      </div>
    </div>
  );
}
