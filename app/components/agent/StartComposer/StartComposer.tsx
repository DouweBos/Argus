import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  FileMentionPicker,
  Icons,
  ImageAttachmentStrip,
  SlashCommandList,
  TextArea,
} from "@argus/peacock";
import { resolveDroppedFilePaths } from "../../../lib/droppedFiles";
import { ACCEPTED_IMAGE_TYPES } from "../../../lib/imageAttachments";
import { insertFileMentions } from "../../../lib/insertFileMentions";
import { startInNewWorktree, startInSession } from "../../../lib/startAgent";
import { capture } from "../../../lib/telemetry";
import { pushError } from "../../../stores/notificationsStore";
import { useSessions } from "../../../stores/sessionStore";
import {
  type StartWorkspace,
  useStartWorkspace,
} from "../../../stores/settingsStore";
import {
  consumeStartDraft,
  useStartDraft,
} from "../../../stores/startDraftStore";
import { ExistingBranchDialog } from "../../sidebar/ExistingBranchDialog";
import { AgentOptionChips } from "./AgentOptionChips";
import styles from "./StartComposer.module.css";
import { BaseBranchChip, WorkspaceChip } from "./WorkspaceChips";
import { useAgentOptions } from "./useAgentOptions";
import { useBaseBranches } from "./useBaseBranches";
import { useImageDraft } from "./useImageDraft";
import { usePromptAssist } from "./usePromptAssist";

interface StartComposerProps {
  autoFocus?: boolean;
  /** The session the composer sits in — "current checkout" means this one. */
  sessionId: string;
}

/**
 * The one place an agent starts from: type the task, then choose whether it
 * runs in the checkout in front of you or in a fresh worktree off a base
 * branch. Nothing is created until you send.
 */
export function StartComposer({
  autoFocus = false,
  sessionId,
}: StartComposerProps) {
  const sessions = useSessions();
  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const repoRoot = session?.repo_root ?? null;
  const isProjectRoot = session?.kind === "project_root";
  const canBranch =
    !!repoRoot && (isProjectRoot || session?.kind === "worktree");
  const projectRootBranch =
    sessions.find((s) => s.repo_root === repoRoot && s.kind === "project_root")
      ?.branch ?? null;

  const [prompt, setPrompt] = useState("");
  const defaultWorkspace = useStartWorkspace();
  // A draft from "New session" overrides the default; picking overrides both.
  const [draftWorkspace, setDraftWorkspace] = useState<StartWorkspace | null>(
    null,
  );
  const [pickedWorkspace, setPickedWorkspace] = useState<StartWorkspace | null>(
    null,
  );
  const openedWith =
    draftWorkspace ?? (isProjectRoot ? defaultWorkspace : "current");
  const workspace = pickedWorkspace ?? openedWith;
  const [pickedBase, setPickedBase] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [existingBranchOpen, setExistingBranchOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const focusPrompt = useCallback(() => promptRef.current?.focus(), []);

  const options = useAgentOptions(sessionId);
  const images = useImageDraft(focusPrompt);
  const assist = usePromptAssist({
    onPromptChange: setPrompt,
    promptRef,
    sessionId,
    slashCommands: options.slashCommands,
  });
  const isWorktree = canBranch && workspace === "worktree";
  const base = useBaseBranches(repoRoot, projectRootBranch, isWorktree);
  const baseBranch = pickedBase ?? base.defaultBranch;

  // "New session" from elsewhere lands here with the prompt box primed.
  const draft = useStartDraft(isProjectRoot ? repoRoot : null);
  useEffect(() => {
    if (!draft) {
      return;
    }
    consumeStartDraft(draft.nonce);
    setDraftWorkspace(draft.workspace);
    setPickedWorkspace(null);
    if (draft.prompt) {
      setPrompt(draft.prompt);
    }
    requestAnimationFrame(focusPrompt);
  }, [draft, focusPrompt]);

  const startable =
    !!session &&
    typeof session.status === "string" &&
    session.status !== "deleting";
  const trimmed = prompt.trim();
  // A worktree's branch is named from the prompt, so it needs words.
  const hasInput = isWorktree
    ? trimmed.length > 0
    : trimmed.length > 0 || images.images.length > 0;
  const canSubmit = startable && hasInput && !submitting;

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    capture("agent_start_submitted", {
      changed_workspace: workspace !== openedWith,
      workspace: isWorktree ? "worktree" : "current",
    });
    const request = {
      images: images.images.map((p) => p.attachment),
      linkedProjects: options.linkedProjects,
      model: options.model,
      permissionMode: options.permissionMode,
      prompt,
      runnerId: options.runnerId,
    };
    try {
      if (isWorktree && repoRoot) {
        await startInNewWorktree(repoRoot, baseBranch ?? undefined, request);
      } else {
        await startInSession(sessionId, request);
      }
      setPrompt("");
      images.clear();
    } catch (err) {
      // A failed worktree was already reported by `createSessionInProject`.
      if (!isWorktree) {
        pushError(
          err instanceof Error ? err.message : String(err),
          "start_agent",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (assist.handlePickerKey(e)) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) {
      return;
    }
    e.preventDefault();
    const [pictures, others] = [
      files.filter((f) => f.type.startsWith("image/")),
      files.filter((f) => !f.type.startsWith("image/")),
    ];
    images.add(pictures);
    if (others.length > 0) {
      // Attached to a host, the drop is uploaded before it can be mentioned.
      resolveDroppedFilePaths(sessionId, others)
        .then(({ paths, errors }) => {
          errors.forEach((message) => pushError(message, "attachment"));
          insertFileMentions(promptRef.current, paths, setPrompt);
        })
        .catch((err: unknown) => pushError(String(err), "attachment"));
    }
  };

  const currentLabel = isProjectRoot ? "Current checkout" : "This worktree";

  return (
    <form
      className={styles.composer}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div
        className={styles.promptStack}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={handleDrop}
      >
        {assist.suggestions.length > 0 && (
          <SlashCommandList
            header="Commands"
            items={assist.suggestions}
            selectedIndex={assist.suggestionIndex}
            onSelect={assist.handleSelectSuggestion}
            onSelectedIndexChange={assist.handleSuggestionIndexChange}
          />
        )}
        {assist.mention.mentionContext && assist.suggestions.length === 0 && (
          <FileMentionPicker
            headerText={assist.mention.headerText}
            items={assist.mention.items}
            selectedIndex={assist.mention.selectedIndex}
            onSelect={(i) => assist.mention.selectItem(promptRef.current, i)}
            onSelectedIndexChange={assist.handleMentionIndexChange}
          />
        )}
        <div className={styles.promptWrap}>
          <TextArea
            ref={promptRef}
            autoFocus={autoFocus}
            aria-label="Prompt"
            placeholder="What should we work on?"
            rows={4}
            value={prompt}
            disabled={!startable}
            onChange={assist.handleChange}
            onKeyDown={handleKeyDown}
            onPaste={images.handlePaste}
            onSelect={() => assist.mention.updateMentions(promptRef.current)}
          />
          <button
            aria-label="Attach image"
            className={styles.attachBtn}
            type="button"
            title="Attach image"
            disabled={!startable}
            onClick={() => images.fileInputRef.current?.click()}
          >
            <Icons.PaperclipIcon />
          </button>
        </div>
      </div>

      <ImageAttachmentStrip
        items={images.images}
        onPreview={images.handlePreview}
        onRemove={images.handleRemove}
      />
      <input
        ref={images.fileInputRef}
        accept={ACCEPTED_IMAGE_TYPES}
        className={styles.hiddenFileInput}
        multiple
        tabIndex={-1}
        type="file"
        onChange={images.handleFileSelect}
      />

      <div className={styles.footer}>
        <div className={styles.chips}>
          {canBranch && (
            <WorkspaceChip
              currentBranch={session?.branch ?? null}
              currentLabel={currentLabel}
              value={workspace}
              onChange={setPickedWorkspace}
              onPickExistingBranch={() => setExistingBranchOpen(true)}
            />
          )}
          {isWorktree && (
            <BaseBranchChip
              loading={base.loading}
              options={base.options}
              value={baseBranch}
              onChange={setPickedBase}
            />
          )}
          <AgentOptionChips
            linkedProjects={options.linkedProjects}
            model={options.model}
            models={options.models}
            permissionMode={options.permissionMode}
            runner={options.runner}
            onModelChange={options.handleModelChange}
            onPermissionModeChange={options.handlePermissionModeChange}
            onToggleLinkedProject={options.handleToggleLinkedProject}
          />
        </div>
        <Button
          variant="primary"
          type="submit"
          leading={<Icons.AgentStartIcon size={12} />}
          disabled={!canSubmit}
        >
          {submitting ? "Starting…" : "Start agent"}
        </Button>
      </div>

      {existingBranchOpen && repoRoot && (
        <ExistingBranchDialog
          repoRoot={repoRoot}
          onClose={() => setExistingBranchOpen(false)}
        />
      )}
    </form>
  );
}
