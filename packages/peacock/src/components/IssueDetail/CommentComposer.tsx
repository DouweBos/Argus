import { useState } from "react";
import { Button } from "../Button/Button";
import { TextArea } from "../Input/Input";
import styles from "./IssueDetail.module.css";

export interface CommentComposerProps {
  /** Posts the trimmed text; rejects with the reason it didn't go. */
  onPost: (body: string) => Promise<void>;
  placeholder: string;
  /** "Reply" in a thread, "Comment" otherwise. */
  sendLabel?: string;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A comment box that posts as you; ⌘↩ sends. */
export function CommentComposer({
  onPost,
  placeholder,
  sendLabel = "Comment",
}: CommentComposerProps) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      await onPost(draft.trim());
      setDraft("");
    } catch (err) {
      setError(message(err));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className={styles.composer}>
      <TextArea
        aria-label={placeholder}
        placeholder={placeholder}
        rows={draft ? 3 : 1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) {
            post().catch(() => {});
          }
        }}
      />
      {draft.trim() && (
        <div className={styles.composerActions}>
          {error && <span className={styles.error}>{error}</span>}
          <Button
            variant="primary"
            size="sm"
            disabled={posting}
            onClick={() => {
              post().catch(() => {});
            }}
          >
            {posting ? "Posting…" : sendLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
