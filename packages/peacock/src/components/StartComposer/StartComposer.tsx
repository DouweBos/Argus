import type {
  ChangeEvent,
  ClipboardEventHandler,
  DragEventHandler,
  KeyboardEventHandler,
  ReactNode,
  Ref,
} from "react";
import { AgentStartIcon, PaperclipIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { TextArea } from "../Input/Input";
import styles from "./StartComposer.module.css";

export interface StartComposerProps {
  prompt: string;
  onPromptChange: (
    prompt: string,
    event: ChangeEvent<HTMLTextAreaElement>,
  ) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  /** "Start agent", "Starting…", "Start 3 agents". */
  submitLabel: string;
  /** Workspace, base branch, model, mode and project chips. */
  chips: ReactNode;
  /** Above the prompt: slash-command and @-mention pickers. */
  above?: ReactNode;
  /** Under the prompt: the attached images. */
  attachments?: ReactNode;
  /** Shows the paperclip; open the file picker from here. */
  onAttach?: () => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  rows?: number;
  promptRef?: Ref<HTMLTextAreaElement>;
  /** Overrides Enter-to-start, e.g. while a picker handles keys. */
  onPromptKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  onSelect?: () => void;
  onDrop?: DragEventHandler<HTMLDivElement>;
  /** Hidden file inputs, dialogs the chips open. */
  children?: ReactNode;
  className?: string;
}

/** Hand dragged files to the drop handler instead of the browser. */
const allowFileDrop: DragEventHandler<HTMLDivElement> = (e) => {
  if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
};

/**
 * Where an agent starts from: the task, then where it runs and on what. The
 * caller owns the draft and the start; Enter starts, Shift+Enter breaks the line.
 */
export function StartComposer({
  prompt,
  onPromptChange,
  onSubmit,
  canSubmit,
  submitLabel,
  chips,
  above,
  attachments,
  onAttach,
  placeholder = "What should we work on?",
  disabled = false,
  autoFocus = false,
  rows = 4,
  promptRef,
  onPromptKeyDown,
  onPaste,
  onSelect,
  onDrop,
  children,
  className,
}: StartComposerProps) {
  return (
    <form
      className={[styles.composer, className].filter(Boolean).join(" ")}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) {
          onSubmit();
        }
      }}
    >
      <div
        className={styles.promptStack}
        onDragOver={onDrop ? allowFileDrop : undefined}
        onDrop={onDrop}
      >
        {above}
        <div className={styles.promptWrap}>
          <TextArea
            ref={promptRef}
            aria-label="Prompt"
            autoFocus={autoFocus}
            disabled={disabled}
            placeholder={placeholder}
            rows={rows}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value, e)}
            onKeyDown={(e) => {
              onPromptKeyDown?.(e);
              if (e.defaultPrevented) {
                return;
              }
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (canSubmit) {
                  onSubmit();
                }
              }
            }}
            onPaste={onPaste}
            onSelect={onSelect}
          />
          {onAttach && (
            <button
              aria-label="Attach image"
              className={styles.attachBtn}
              disabled={disabled}
              title="Attach image"
              type="button"
              onClick={onAttach}
            >
              <PaperclipIcon />
            </button>
          )}
        </div>
      </div>
      {attachments}
      <div className={styles.footer}>
        <div className={styles.chips}>{chips}</div>
        <Button
          disabled={!canSubmit}
          leading={<AgentStartIcon size={12} />}
          type="submit"
          variant="primary"
        >
          {submitLabel}
        </Button>
      </div>
      {children}
    </form>
  );
}
