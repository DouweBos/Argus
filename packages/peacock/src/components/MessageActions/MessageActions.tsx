import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BranchIcon,
  CheckIcon,
  CopyIcon,
  HistoryIcon,
  PencilIcon,
} from "../../icons/Icons";
import { Button } from "../Button/Button";
import { HoverActionButton } from "../HoverActionBar/HoverActionBar";
import styles from "./MessageActions.module.css";

export interface MessageActionsProps {
  onCopy?: () => void;
  onEdit?: () => void;
  /** Restore files and chat to this point (the desktop's checkpoints). */
  onRestore?: () => void;
  onFork?: () => void;
}

/** Copy / edit / restore / fork, for a {@link MessageBubble}'s `actions` slot. Null when none apply. */
export function MessageActions({
  onCopy,
  onEdit,
  onRestore,
  onFork,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!onCopy && !onEdit && !onFork && !onRestore) {
    return null;
  }

  return (
    <>
      {onCopy && (
        <HoverActionButton
          icon={copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          label={copied ? "Copied" : "Copy message"}
          onClick={() => {
            onCopy();
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          }}
        />
      )}
      {onEdit && (
        <HoverActionButton
          icon={<PencilIcon size={12} />}
          label="Edit message"
          onClick={onEdit}
        />
      )}
      {onRestore && (
        <HoverActionButton
          icon={<HistoryIcon size={12} />}
          label="Restore files and chat to this point"
          onClick={onRestore}
        />
      )}
      {onFork && (
        <HoverActionButton
          icon={<BranchIcon size={12} />}
          label="Fork workspace and chat from here"
          onClick={onFork}
        />
      )}
    </>
  );
}

function TimestampGutter({ timestamp }: { timestamp: number }) {
  const d = new Date(timestamp);

  return (
    <time
      className={styles.timestamp}
      dateTime={d.toISOString()}
      title={d.toLocaleString()}
    >
      {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}

export interface MessageEditFormProps {
  /** What the editor opens with: the message as shown, never its preamble. */
  initialText: string;
  /** Called with the trimmed text; omitted when it's unchanged. */
  onSave: (text: string) => void;
  onCancel: () => void;
  timestamp?: number;
  /** The bubble's measured width, so the editor opens no narrower than it. */
  minWidth?: number;
  saveLabel?: string;
  /** Under the editor, e.g. "The chat rewinds to here". */
  hint?: ReactNode;
  busy?: boolean;
  error?: string | null;
}

/** A user message edited in place: Esc cancels, ⌘/Ctrl+Enter saves. */
export function MessageEditForm({
  initialText,
  onSave,
  onCancel,
  timestamp,
  minWidth,
  saveLabel = "Save",
  hint,
  busy = false,
  error,
}: MessageEditFormProps) {
  const [draft, setDraft] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const trimmed = draft.trim();
  const submit = () => {
    if (!trimmed || busy) {
      return;
    }
    if (trimmed === initialText.trim()) {
      onCancel();

      return;
    }
    onSave(trimmed);
  };
  // The measured width is layout, not colour; it can only come from the caller.
  const sized: CSSProperties | undefined =
    minWidth !== undefined ? { minWidth } : undefined;

  return (
    <div className={styles.userMsg}>
      {timestamp !== undefined && <TimestampGutter timestamp={timestamp} />}
      <div className={styles.userEdit} style={sized}>
        <div className={styles.userEditGrow} data-value={draft}>
          <textarea
            ref={ref}
            aria-label="Edit message"
            className={styles.userEditArea}
            cols={1}
            disabled={busy}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        {hint && <div className={styles.hint}>{hint}</div>}
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.userEditActions}>
          <Button size="sm" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!trimmed || busy}
            size="sm"
            variant="primary"
            onClick={submit}
          >
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
