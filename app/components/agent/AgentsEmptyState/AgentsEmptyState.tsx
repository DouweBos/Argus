import type { PendingImage } from "../../../stores/conversationStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Chip,
  IconBadge,
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
import {
  type CanonicalPermissionMode,
  permissionModeDisplayName,
} from "../../../lib/permissionModes";
import { isSessionReady } from "../../../lib/types";
import { openImageViewer } from "../../../stores/imageViewerStore";
import { pushError } from "../../../stores/notificationsStore";
import { useSessions } from "../../../stores/sessionStore";
import { getDefaultPermissionMode } from "../../../stores/settingsStore";
import { PermissionModePicker } from "../PermissionModePicker";
import { StartAgentDialog } from "../StartAgentDialog";
import styles from "./AgentsEmptyState.module.css";

interface AgentsEmptyStateProps {
  sessionId: string;
}

export function AgentsEmptyState({ sessionId }: AgentsEmptyStateProps) {
  const sessions = useSessions();
  const session = useMemo(
    () => sessions.find((w) => w.id === sessionId) ?? null,
    [sessions, sessionId],
  );

  const canStart = useMemo(() => {
    if (!session) {
      return false;
    }
    if (typeof session.status === "object") {
      return false;
    }

    return session.status !== "deleting";
  }, [session]);

  const ready = session ? isSessionReady(session.status) : false;

  const [prompt, setPrompt] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [permissionMode, setPermissionMode] = useState<CanonicalPermissionMode>(
    getDefaultPermissionMode,
  );
  const [permissionPickerOpen, setPermissionPickerOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const permissionChipRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs when unmounting so previews don't leak.
  useEffect(() => {
    return () => {
      for (const img of pendingImages) {
        URL.revokeObjectURL(img.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const imageFiles = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (imageFiles.length > 0) {
        e.preventDefault();
        addImageFiles(imageFiles);
      }
    },
    [addImageFiles],
  );

  const trimmed = prompt.trim();
  const canSubmit =
    (trimmed.length > 0 || pendingImages.length > 0) &&
    canStart &&
    ready &&
    !submitting;

  const submitLabel = (() => {
    if (submitting) {
      return "Starting…";
    }
    if (permissionMode === "auto") {
      return "Start agent";
    }

    return `Start in ${permissionModeDisplayName(permissionMode).toLowerCase()} mode`;
  })();

  const spawn = useCallback(
    async (mode: CanonicalPermissionMode) => {
      if (!canSubmit) {
        return;
      }
      setSubmitting(true);
      const message = trimmed || "(see attached images)";
      const images =
        pendingImages.length > 0
          ? pendingImages.map((p) => p.attachment)
          : undefined;
      try {
        const info = await startAgentInSession(sessionId, {
          focus: true,
          permissionMode: mode,
        });
        await sendUserMessageToAgent(info.agent_id, message, images, {
          assumeIdle: true,
        });
        setPrompt("");
        setPendingImages([]);
      } catch (err) {
        pushError(
          err instanceof Error ? err.message : String(err),
          "start_agent",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, sessionId, trimmed, pendingImages],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        spawn(permissionMode);
      }
    },
    [spawn, permissionMode],
  );

  return (
    <div className={styles.screen}>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <IconBadge size="lg" tone="neutral">
            <Icons.AgentIcon size={20} />
          </IconBadge>
          <h1 className={styles.title}>Start an agent</h1>
          <p className={styles.body}>
            Describe what you want done. The agent will spawn here and start
            working — open more tabs to run agents in parallel.
          </p>
        </div>

        <form
          className={styles.composer}
          onSubmit={(e) => {
            e.preventDefault();
            spawn(permissionMode);
          }}
        >
          <div
            className={styles.promptWrap}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <TextArea
              ref={promptRef}
              autoFocus
              placeholder="What should the agent work on?"
              rows={4}
              value={prompt}
              disabled={!canStart}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
            <button
              aria-label="Attach image"
              className={styles.promptAttachBtn}
              type="button"
              title="Attach image"
              disabled={!canStart}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icons.PaperclipIcon />
            </button>
          </div>

          <ImageAttachmentStrip
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

          <input
            ref={fileInputRef}
            accept={ACCEPTED_IMAGE_TYPES}
            className={styles.hiddenFileInput}
            multiple
            tabIndex={-1}
            type="file"
            onChange={handleFileSelect}
          />

          <div className={styles.composerFooter}>
            <div className={styles.composerLeft}>
              <button
                type="button"
                className={styles.advancedLink}
                onClick={() => setAdvancedOpen(true)}
                title="Open the full Start agent dialog (model, linked projects, images)"
              >
                Advanced…
              </button>
              <div ref={permissionChipRef} className={styles.permissionAnchor}>
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
            </div>
            <div className={styles.composerActions}>
              <Button
                variant="primary"
                type="submit"
                leading={<Icons.AgentStartIcon size={12} />}
                disabled={!canSubmit}
              >
                {submitLabel}
              </Button>
            </div>
          </div>
          <div className={styles.hint}>
            <kbd className={styles.kbd}>⌘</kbd>
            <kbd className={styles.kbd}>↵</kbd>
            <span>to start</span>
          </div>
        </form>
      </div>

      {advancedOpen && (
        <StartAgentDialog
          initialMode={permissionMode}
          initialPrompt={prompt}
          sessionId={sessionId}
          onClose={() => setAdvancedOpen(false)}
          onPromptChange={setPrompt}
        />
      )}
    </div>
  );
}
