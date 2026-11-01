/**
 * Remote chat input — the web-client counterpart of the desktop ChatInput.
 * Sends messages + images, interrupts, switches model / permission mode /
 * effort, and offers slash-command and @-mention autocomplete. Rendered only
 * for devices holding the "control" grant (gated by the caller).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ChatInputShell,
  Chip,
  ContextMeter,
  createTypingReporter,
  FileMentionPicker,
  FollowUpSuggestions,
  Icons,
  ImageAttachmentStrip,
  PickerPopover,
  SlashCommandList,
} from "@argus/peacock";
import {
  contextLimitForModel,
  formatTokenCount,
  tokensInContext,
} from "../lib/contextWindow";
import {
  ACCEPTED_IMAGE_TYPES,
  extractImageFilesFromClipboard,
  filesToPendingImages,
  type PendingImage,
} from "../lib/images";
import { hasHardwareKeyboard } from "../lib/keyboard";
import { buildLinkedProjectsPreamble } from "../lib/linkedProjects";
import type {
  RemoteModelInfo,
  RemotePermissionMode,
  RemoteSlashCommand,
} from "../lib/protocol";
import { useAppStore } from "../lib/store";
import { useMentionPicker } from "./useMentionPicker";

/** The computer never lets a remote switch an agent into Trusted, so it isn't offered. */
const PERMISSION_MODES: RemotePermissionMode[] = ["auto", "ask", "plan", "review"];

/** What the chip can show: an agent started Trusted on the computer still says so. */
type ShownMode = RemotePermissionMode | "trusted";

const PERMISSION_LABELS: Record<ShownMode, string> = {
  auto: "Auto",
  ask: "Ask",
  plan: "Plan",
  review: "Review",
  trusted: "Trusted",
};

function canonicalMode(mode: string | null | undefined): ShownMode {
  if (mode === "trusted") {
    return mode;
  }

  return PERMISSION_MODES.find((m) => m === mode) ?? "auto";
}

const NO_FOLLOW_UPS: string[] = [];

function draftKey(agentId: string): string {
  return `argus.draft.${agentId}`;
}
function linkedKey(agentId: string): string {
  return `argus.linked.${agentId}`;
}
function readLinked(agentId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(linkedKey(agentId)) ?? "[]");
  } catch {
    return [];
  }
}

/**
 * Context-window meter, isolated so its subscription to the (frequently
 * changing) transcript doesn't re-render the whole ChatInput — that caused the
 * chips and input to flash while typing as messages streamed in.
 */
function ContextMeterChip({
  agentId,
  modelValue,
  models,
}: {
  agentId: string;
  modelValue: string | null;
  models: RemoteModelInfo[];
}) {
  const messages = useAppStore((s) => s.messagesByAgent[agentId]);
  const reported = useAppStore((s) => s.statusByAgent[agentId]?.context_window);
  const contextTokens = useMemo(() => {
    if (!messages) {
      return 0;
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.usage) {
        return tokensInContext(m.usage);
      }
    }

    return 0;
  }, [messages]);

  if (contextTokens <= 0) {
    return null;
  }
  // The host relays what the CLI reported; the guess covers the first turn.
  const contextLimit = reported ?? contextLimitForModel(modelValue, models);
  const pct = contextLimit > 0 ? (contextTokens / contextLimit) * 100 : 0;

  return (
    <span
      className="aw-context-meter"
      title={`Context: ${Math.round(pct)}% of ${formatTokenCount(contextLimit)} tokens (${formatTokenCount(contextTokens)} used)`}
    >
      <ContextMeter progress={contextTokens / contextLimit} size={16} />
    </span>
  );
}

export function ChatInput({
  agentId,
  sessionId,
}: {
  agentId: string;
  sessionId?: string;
}) {
  const status = useAppStore((s) => s.statusByAgent[agentId]);
  const caps = useAppStore((s) => s.capabilitiesByAgent[agentId]);
  const effort = useAppStore((s) => s.effortByAgent[agentId] ?? null);
  const followUps = useAppStore(
    (s) => s.followUpsByAgent[agentId] ?? NO_FOLLOW_UPS,
  );
  const loadCapabilities = useAppStore((s) => s.loadCapabilities);
  const loadAgentStatus = useAppStore((s) => s.loadAgentStatus);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const queueMessage = useAppStore((s) => s.queueMessage);
  const interrupt = useAppStore((s) => s.interrupt);
  const setModel = useAppStore((s) => s.setModel);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const setEffort = useAppStore((s) => s.setEffort);
  const projects = useAppStore((s) => s.projects);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const setHuddleTyping = useAppStore((s) => s.setHuddleTyping);

  // A no-op outside a huddle, so the composer reports either way and never has
  // to know which kind of connection it is sitting on.
  const typingReporter = useMemo(
    () => createTypingReporter(setHuddleTyping),
    [setHuddleTyping],
  );
  useEffect(() => () => typingReporter.stop(), [typingReporter]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelChipRef = useRef<HTMLDivElement>(null);
  const modeChipRef = useRef<HTMLDivElement>(null);
  const effortChipRef = useRef<HTMLDivElement>(null);
  const projectChipRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [suggestions, setSuggestions] = useState<RemoteSlashCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [openPicker, setOpenPicker] = useState<
    "effort" | "mode" | "model" | "project" | null
  >(null);
  const [linked, setLinked] = useState<string[]>(() => readLinked(agentId));
  const [dragOver, setDragOver] = useState(false);
  // Whether the textarea has content — the textarea is uncontrolled, so this
  // mirror lets the buttons react (e.g. show "queue" while the agent is busy).
  const [hasText, setHasText] = useState(false);
  const dragDepth = useRef(0);
  // Read once: a keyboard case being attached mid-message is not worth a
  // listener, and the send button works either way.
  const [sendsOnEnter] = useState(hasHardwareKeyboard);

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

  const isRunning = status?.status === "running";
  const mode = canonicalMode(status?.permission_mode);
  const modelValue = status?.model ?? null;
  const models = caps?.models ?? [];
  const commands = caps?.commands ?? [];
  const currentModel = models.find((m) => m.value === modelValue);
  const modelLabel = currentModel?.displayName ?? modelValue ?? "Model";
  const effortLevels = currentModel?.supportsEffort
    ? (currentModel.supportedEffortLevels ?? [])
    : [];

  useEffect(() => {
    loadCapabilities(agentId).catch(() => {});
    loadAgentStatus(agentId).catch(() => {});
  }, [agentId, loadCapabilities, loadAgentStatus]);

  // Reset linked projects when switching agents (persisted per agent).
  useEffect(() => {
    setLinked(readLinked(agentId));
  }, [agentId]);

  const toggleLinked = useCallback(
    (path: string) => {
      setLinked((prev) => {
        const next = prev.includes(path)
          ? prev.filter((p) => p !== path)
          : [...prev, path];
        localStorage.setItem(linkedKey(agentId), JSON.stringify(next));

        return next;
      });
    },
    [agentId],
  );

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  // Seed the (uncontrolled) textarea with the persisted draft on agent switch.
  // Size + focus after layout (rAF) — measuring scrollHeight synchronously on
  // mount can read 0 and leave the caret detached until the first keystroke.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.value = localStorage.getItem(draftKey(agentId)) ?? "";
    setHasText(el.value.trim().length > 0);
    const raf = requestAnimationFrame(() => {
      adjustHeight();
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });

    return () => cancelAnimationFrame(raf);
  }, [agentId, adjustHeight]);

  const updateSuggestions = useCallback(() => {
    const el = textareaRef.current;
    if (!el || commands.length === 0) {
      setSuggestions([]);

      return;
    }
    const val = el.value;
    if (val.startsWith("/") && !val.includes(" ") && !val.includes("\n")) {
      const q = val.slice(1).toLowerCase();
      setSuggestions(
        commands.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8),
      );
      setSelectedIndex(0);
    } else {
      setSuggestions([]);
    }
  }, [commands]);

  const handleInput = useCallback(() => {
    adjustHeight();
    updateSuggestions();
    updateMentions(textareaRef.current);
    typingReporter.keystroke();
    setHasText((textareaRef.current?.value.trim().length ?? 0) > 0);
    localStorage.setItem(draftKey(agentId), textareaRef.current?.value ?? "");
  }, [adjustHeight, updateSuggestions, updateMentions, typingReporter, agentId]);

  const submit = useCallback(() => {
    const value = textareaRef.current?.value.trim() ?? "";
    if (!value && pending.length === 0) {
      return;
    }
    const images =
      pending.length > 0 ? pending.map((p) => p.attachment) : undefined;
    const displayText = value || "(see attached images)";
    const message = buildLinkedProjectsPreamble(linked, displayText);
    // Busy agent → park it on the computer's queue, which the desktop drains
    // when the turn ends. Idle → send straight away.
    if (isRunning) {
      queueMessage(agentId, message, images, displayText).catch(() => {});
    } else {
      sendMessage(agentId, message, images, displayText).catch(() => {});
    }
    if (textareaRef.current) {
      textareaRef.current.value = "";
      adjustHeight();
    }
    setHasText(false);
    localStorage.removeItem(draftKey(agentId));
    localStorage.removeItem(linkedKey(agentId));
    setLinked([]);
    pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPending([]);
    setSuggestions([]);
    dismissMention();
    typingReporter.stop();
  }, [
    agentId,
    typingReporter,
    pending,
    sendMessage,
    queueMessage,
    isRunning,
    adjustHeight,
    dismissMention,
    linked,
  ]);

  const applySuggestion = useCallback(
    (cmd: RemoteSlashCommand) => {
      const el = textareaRef.current;
      if (!el) {
        return;
      }
      el.value = `/${cmd.name} `;
      el.focus();
      setSuggestions([]);
      adjustHeight();
      localStorage.setItem(draftKey(agentId), el.value);
    },
    [adjustHeight, agentId],
  );

  // Fills the input, never sends: the user reads it over first.
  const fillFollowUp = useCallback(
    (text: string) => {
      const el = textareaRef.current;
      if (!el) {
        return;
      }
      el.value = text;
      el.focus();
      el.setSelectionRange(text.length, text.length);
      setHasText(true);
      adjustHeight();
      localStorage.setItem(draftKey(agentId), text);
    },
    [adjustHeight, agentId],
  );
  const shownFollowUps = hasText || isRunning ? NO_FOLLOW_UPS : followUps;

  const addImageFiles = useCallback(async (files: File[]) => {
    const next = await filesToPendingImages(files);
    if (next.length > 0) {
      setPending((prev) => [...prev, ...next]);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter confirming an IME candidate is not Enter meaning anything here —
      // it must reach neither the pickers below nor the composer.
      if (e.nativeEvent.isComposing) {
        return;
      }

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

      if (mentionContext && mentionItems.length > 0) {
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
        if (e.key === "Escape") {
          e.preventDefault();
          dismissMention();

          return;
        }
      }

      if (e.key === "Tab" && !e.shiftKey && shownFollowUps[0]) {
        e.preventDefault();
        fillFollowUp(shownFollowUps[0]);

        return;
      }

      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        const next =
          PERMISSION_MODES[
            (PERMISSION_MODES.findIndex((m) => m === mode) + 1) %
              PERMISSION_MODES.length
          ];
        setPermissionMode(agentId, next).catch(() => {});

        return;
      }

      // ⌘/Ctrl+Enter always sends, whatever plain Enter is doing.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();

        return;
      }

      // With a real keyboard, Enter sends and Shift+Enter breaks the line, like
      // the desktop app. On a phone there is no Shift to reach the newline
      // with, so Enter stays the newline and the send button does the sending.
      if (e.key === "Enter" && !e.shiftKey && sendsOnEnter) {
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
      mode,
      agentId,
      sendsOnEnter,
      setPermissionMode,
      shownFollowUps,
      fillFollowUp,
    ],
  );

  const above = (
    <>
      <SlashCommandList
        items={suggestions}
        selectedIndex={selectedIndex}
        onSelect={(i) => applySuggestion(suggestions[i])}
        onSelectedIndexChange={setSelectedIndex}
      />

      {suggestions.length === 0 && !mentionContext && (
        <FollowUpSuggestions
          items={shownFollowUps}
          tabHint={sendsOnEnter}
          onSelect={(i) => fillFollowUp(shownFollowUps[i]!)}
        />
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
        items={pending}
        onRemove={(i) => {
          setPending((prev) => {
            const removed = prev[i];
            if (removed) {
              URL.revokeObjectURL(removed.previewUrl);
            }

            return prev.filter((_, idx) => idx !== i);
          });
        }}
      />
    </>
  );

  const actions = (
    <>
      <ContextMeterChip agentId={agentId} modelValue={modelValue} models={models} />
      {(models.length > 0 || modelValue) && (
        <div className="aw-picker-anchor" ref={modelChipRef}>
          <Chip
            mono
            muted
            interactive
            title="Switch model"
            onClick={() => setOpenPicker((p) => (p === "model" ? null : "model"))}
          >
            {modelLabel}
          </Chip>
          {openPicker === "model" && (
            <PickerPopover
              triggerRef={modelChipRef}
              onClose={() => setOpenPicker(null)}
            >
              {models.length === 0 && (
                <PickerPopover.Empty>Loading models…</PickerPopover.Empty>
              )}
              {models.map((m) => (
                <PickerPopover.Option
                  key={m.value}
                  name={m.displayName}
                  description={m.description}
                  selected={m.value === modelValue}
                  onSelect={() => {
                    setOpenPicker(null);
                    setModel(agentId, m.value).catch(() => {});
                  }}
                />
              ))}
            </PickerPopover>
          )}
        </div>
      )}
      <div className="aw-picker-anchor" ref={modeChipRef}>
        <Chip
          interactive
          muted={mode === "auto"}
          title="Switch permission mode (Shift+Tab to cycle)"
          onClick={() => setOpenPicker((p) => (p === "mode" ? null : "mode"))}
        >
          {PERMISSION_LABELS[mode]}
        </Chip>
        {openPicker === "mode" && (
          <PickerPopover
            triggerRef={modeChipRef}
            onClose={() => setOpenPicker(null)}
          >
            {PERMISSION_MODES.map((m) => (
              <PickerPopover.Option
                key={m}
                name={PERMISSION_LABELS[m]}
                selected={m === mode}
                onSelect={() => {
                  setOpenPicker(null);
                  setPermissionMode(agentId, m).catch(() => {});
                }}
              />
            ))}
          </PickerPopover>
        )}
      </div>
      {effortLevels.length > 0 && (
        <div className="aw-picker-anchor" ref={effortChipRef}>
          <Chip
            interactive
            muted={!effort}
            title="Switch reasoning effort"
            onClick={() =>
              setOpenPicker((p) => (p === "effort" ? null : "effort"))
            }
          >
            {effort ?? "Effort"}
          </Chip>
          {openPicker === "effort" && (
            <PickerPopover
              triggerRef={effortChipRef}
              onClose={() => setOpenPicker(null)}
            >
              {[{ value: "", label: "Default" }, ...effortLevels.map((l) => ({ value: l, label: l }))].map(
                (o) => (
                  <PickerPopover.Option
                    key={o.value || "default"}
                    name={o.label}
                    selected={o.value === (effort ?? "")}
                    onSelect={() => {
                      setOpenPicker(null);
                      setEffort(agentId, o.value || null).catch(() => {});
                    }}
                  />
                ),
              )}
            </PickerPopover>
          )}
        </div>
      )}
      <div className="aw-picker-anchor" ref={projectChipRef}>
        <Chip
          interactive
          muted={linked.length === 0}
          title="Link other projects"
          leading={<Icons.FolderIcon size={11} />}
          onClick={() => {
            refreshProjects().catch(() => {});
            setOpenPicker((p) => (p === "project" ? null : "project"));
          }}
        >
          {linked.length === 0 ? "Link project" : `${linked.length} linked`}
        </Chip>
        {openPicker === "project" && (
          <PickerPopover
            triggerRef={projectChipRef}
            onClose={() => setOpenPicker(null)}
          >
            {projects.length === 0 && (
              <PickerPopover.Empty>No other projects open</PickerPopover.Empty>
            )}
            {projects.map((p) => (
              <PickerPopover.Option
                key={p.repo_root}
                name={p.name}
                description={p.repo_root}
                selected={linked.includes(p.repo_root)}
                onSelect={() => toggleLinked(p.repo_root)}
              />
            ))}
          </PickerPopover>
        )}
      </div>
    </>
  );

  const trailing = (
    <>
      <button
        aria-label="Attach image"
        className="aw-attach-btn"
        title="Attach image"
        onClick={() => fileInputRef.current?.click()}
      >
        <Icons.PaperclipIcon />
      </button>
      {isRunning && hasText && (
        <Button
          variant="send"
          aria-label="Queue message"
          title="Queue — sends when the agent is idle"
          onClick={submit}
        >
          <Icons.SendIcon />
        </Button>
      )}
      {isRunning ? (
        <Button
          variant="stop"
          aria-label="Stop agent"
          title="Stop"
          onClick={() => interrupt(agentId).catch(() => {})}
        >
          <Icons.StopIcon />
        </Button>
      ) : (
        <Button
          variant="send"
          aria-label="Send message"
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
      above={above}
      actions={actions}
      trailing={trailing}
      dragOver={dragOver}
      onDragEnter={(e) => {
        if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
          e.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        }
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) {
          setDragOver(false);
        }
      }}
      onDrop={(e) => {
        const files = e.dataTransfer?.files;
        dragDepth.current = 0;
        setDragOver(false);
        if (files && files.length > 0) {
          e.preventDefault();
          addImageFiles(Array.from(files)).catch(() => {});
        }
      }}
    >
      <textarea
        ref={textareaRef}
        aria-label="Message the agent"
        className="aw-chat-textarea"
        placeholder={
          sendsOnEnter
            ? "Message the agent… (Enter to send, / for commands, @ for files)"
            : "Message the agent… (⌘/Ctrl+Enter to send, / for commands, @ for files)"
        }
        rows={1}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={(e) => {
          const imgs = extractImageFilesFromClipboard(e);
          if (imgs.length > 0) {
            e.preventDefault();
            addImageFiles(imgs).catch(() => {});
          }
        }}
        onSelect={() => updateMentions(textareaRef.current)}
      />
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
            addImageFiles(Array.from(files)).catch(() => {});
          }
          e.target.value = "";
          textareaRef.current?.focus();
        }}
      />
    </ChatInputShell>
  );
}
