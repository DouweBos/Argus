import type { LinearIssue } from "../../../lib/types";
import { useState } from "react";
import { Button, TextArea } from "@argus/peacock";
import { postLinearComment } from "../../../stores/linearIssuesStore";
import styles from "./IssueDetail.module.css";

interface CommentComposerProps {
  issue: LinearIssue;
  /** Replies in this comment's thread; omit for a new comment. */
  parentId?: string | null;
  placeholder: string;
}

/** A comment box that posts as you; ⌘↩ sends. */
export function CommentComposer({
  issue,
  parentId = null,
  placeholder,
}: CommentComposerProps) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendLabel = parentId ? "Reply" : "Comment";

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      await postLinearComment(issue, draft.trim(), parentId);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
