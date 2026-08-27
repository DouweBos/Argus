/**
 * Remote chat input — the web-client counterpart of the desktop ChatInput.
 * Sends messages + images, interrupts, switches model / permission mode /
 * effort, and offers slash-command and @-mention autocomplete. Rendered only
 * for devices holding the "control" grant (gated by the caller).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  ChatInputShell,
  Chip,
  ContextMeter,
  Icons,
  ImageAttachmentStrip,
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
import { buildLinkedProjectsPreamble } from "../lib/linkedProjects";
import type {
  RemoteModelInfo,
  RemotePermissionMode,
  RemoteSlashCommand,
} from "../lib/protocol";
import { useAppStore } from "../lib/store";
import { useMentionPicker } from "./useMentionPicker";

const PERMISSION_MODES: RemotePermissionMode[] = [
  "auto",
  "ask",
  "plan",
  "review",
  "trusted",
];
const PERMISSION_LABELS: Record<RemotePermissionMode, string> = {
  auto: "Auto",
  ask: "Ask",
  plan: "Plan",
  review: "Review",
  trusted: "Trusted",
};

function canonicalMode(mode: string | null | undefined): RemotePermissionMode {
  return mode && (PERMISSION_MODES as string[]).includes(mode)
    ? (mode as RemotePermissionMode)
    : "auto";
}

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

interface Option {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Options list anchored above its trigger chip. Rendered in a portal so it
 * isn't clipped by the toolbar's `overflow` (the chips scroll horizontally).
 */
function Dropdown({
  anchorRef,
  options,
  current,
  multi,
  selected,
  onSelect,
  onClose,
  empty,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  options: Option[];
  current?: string | null;
  /** Multi-select (checkbox) mode — keeps the menu open on click. */
  multi?: boolean;
  selected?: string[];
  onSelect: (value: string) => void;
  onClose: () => void;
  empty?: string;
}) {
  const rect = anchorRef.current?.getBoundingClientRect();
  const style: React.CSSProperties = rect
    ? {
        position: "fixed",
        left: rect.left,
        bottom: window.innerHeight - rect.top + 6,
        minWidth: Math.max(rect.width, 180),
      }
    : { display: "none" };

  return createPortal(
    <>
      <div className="aw-dropdown-scrim" onClick={onClose} />
      <div className="aw-dropdown" role="listbox" style={style}>
        {options.length === 0 && empty && (
          <div className="aw-dropdown-empty">{empty}</div>
        )}
        {options.map((o) => {
          const active = multi
            ? (selected ?? []).includes(o.value)
            : o.value === current;

          return (
            <button
              key={o.value}
              className={`aw-dropdown-item${active ? " aw-dropdown-item-active" : ""}`}
              onClick={() => {
                onSelect(o.value);
                if (!multi) {
                  onClose();
                }
              }}
            >
              <span>{o.label}</span>
              {o.hint && <span className="aw-dropdown-hint">{o.hint}</span>}
            </button>
          );
        })}
      </div>
    </>,
    document.body,
  );
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
  const contextLimit = contextLimitForModel(modelValue, models);
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
    setHasText((textareaRef.current?.value.trim().length ?? 0) > 0);
    localStorage.setItem(draftKey(agentId), textareaRef.current?.value ?? "");
  }, [adjustHeight, updateSuggestions, updateMentions, agentId]);

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
  }, [
    agentId,
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

  const addImageFiles = useCallback(async (files: File[]) => {
    const next = await filesToPendingImages(files);
    if (next.length > 0) {
      setPending((prev) => [...prev, ...next]);
    }
  }, []);

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

      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        const next =
          PERMISSION_MODES[
            (PERMISSION_MODES.indexOf(mode) + 1) % PERMISSION_MODES.length
          ];
        setPermissionMode(agentId, next).catch(() => {});

        return;
      }

      // Enter inserts a newline (native textarea behavior); send with the
      // button or ⌘/Ctrl+Enter, so multi-line messages are easy on a phone.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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
      setPermissionMode,
    ],
  );

  const above = (
    <>
      {suggestions.length > 0 && (
        <div className="aw-suggestions">
          <div className="aw-suggestions-header">Commands</div>
          {suggestions.map((cmd, i) => (
            <button
              key={cmd.name}
              className={`aw-suggestion${i === selectedIndex ? " aw-suggestion-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(cmd);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="aw-suggestion-slash">/</span>
              <span className="aw-suggestion-name">{cmd.name}</span>
              {cmd.description && (
                <span className="aw-suggestion-desc">{cmd.description}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {mentionContext && suggestions.length === 0 && (
        <div className="aw-suggestions">
          <div className="aw-suggestions-header">{mentionHeaderText}</div>
          {mentionItems.map((item, i) => (
            <button
              key={`${item.display}-${i}`}
              className={[
                "aw-suggestion",
                i === mentionSelectedIndex ? "aw-suggestion-active" : "",
                item.isLinkAction ? "aw-suggestion-link" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseDown={(e) => {
                e.preventDefault();
                selectMentionItem(textareaRef.current, i);
                adjustHeight();
              }}
              onMouseEnter={() => setMentionSelectedIndex(i)}
            >
              {item.isDir ? (
                <Icons.FolderIcon size={12} />
              ) : (
                <Icons.FileIcon size={12} />
              )}
              {item.isLinkAction ? (
                <>
                  <span className="aw-suggestion-name">Use this directory</span>
                  <span className="aw-suggestion-desc">{item.display}</span>
                </>
              ) : (
                <>
                  <span className="aw-suggestion-name">{item.display}</span>
                  {item.hint && (
                    <span className="aw-suggestion-desc">{item.hint}</span>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
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
            <Dropdown
              anchorRef={modelChipRef}
              current={modelValue}
              empty="Loading models…"
              options={models.map((m) => ({
                value: m.value,
                label: m.displayName,
                hint: m.description,
              }))}
              onSelect={(v) => setModel(agentId, v).catch(() => {})}
              onClose={() => setOpenPicker(null)}
            />
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
          <Dropdown
            anchorRef={modeChipRef}
            current={mode}
            options={PERMISSION_MODES.map((m) => ({
              value: m,
              label: PERMISSION_LABELS[m],
            }))}
            onSelect={(v) =>
              setPermissionMode(agentId, v as RemotePermissionMode).catch(
                () => {},
              )
            }
            onClose={() => setOpenPicker(null)}
          />
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
            <Dropdown
              anchorRef={effortChipRef}
              current={effort ?? ""}
              options={[
                { value: "", label: "Default" },
                ...effortLevels.map((l) => ({ value: l, label: l })),
              ]}
              onSelect={(v) => setEffort(agentId, v || null).catch(() => {})}
              onClose={() => setOpenPicker(null)}
            />
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
          <Dropdown
            anchorRef={projectChipRef}
            multi
            selected={linked}
            empty="No other projects open"
            options={projects.map((p) => ({
              value: p.repo_root,
              label: p.name,
              hint: p.repo_root,
            }))}
            onSelect={toggleLinked}
            onClose={() => setOpenPicker(null)}
          />
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
        placeholder="Message the agent… (⌘/Ctrl+Enter to send, / for commands, @ for files)"
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
