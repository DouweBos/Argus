import type { LinearIssueDetail } from "../../../lib/types";
import { useState } from "react";
import { Button, Markdown, TextArea } from "@argus/peacock";
import { formatIssueDate } from "../../../lib/issueBoard";
import { postLinearComment } from "../../../stores/linearIssuesStore";
import styles from "./IssueDetail.module.css";

/** The thread, oldest first, with a box to add to it as yourself. */
export function IssueComments({ issue }: { issue: LinearIssueDetail }) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      await postLinearComment(issue, draft.trim());
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        Comments <span className={styles.muted}>{issue.comments.length}</span>
      </h3>
      {issue.comments.map((comment, i) => (
        <div key={`${comment.createdAt}-${i}`} className={styles.comment}>
          <div className={styles.commentHead}>
            <span>{comment.author ?? "Someone"}</span>
            <span className={styles.muted}>
              {formatIssueDate(comment.createdAt)}
            </span>
          </div>
          <Markdown text={comment.body} />
        </div>
      ))}
      <div className={styles.composer}>
        <TextArea
          aria-label="Comment"
          placeholder="Leave a comment…"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) {
              post().catch(() => {});
            }
          }}
        />
        <div className={styles.composerActions}>
          {error && <span className={styles.error}>{error}</span>}
          <Button
            variant="primary"
            size="sm"
            disabled={!draft.trim() || posting}
            onClick={() => {
              post().catch(() => {});
            }}
          >
            {posting ? "Posting…" : "Comment"}
          </Button>
        </div>
      </div>
    </section>
  );
}
