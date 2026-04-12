import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGitAuthor, gitCommit } from "../../../lib/ipc";
import { md5Hex } from "../../../lib/md5";
import styles from "./CommitPanel.module.css";

export interface CommitPanelProps {
  allStaged: boolean;
  anyStaged: boolean;
  onAction: (action: () => Promise<void>) => Promise<void>;
  onCommitted: () => void;
  onStageAll: () => Promise<void>;
  onUnstageAll: () => Promise<void>;
  workspaceId: string;
}

export function CommitPanel({
  workspaceId,
  allStaged,
  anyStaged,
  onStageAll,
  onUnstageAll,
  onAction,
  onCommitted,
}: CommitPanelProps) {
  const [commitSubject, setCommitSubject] = useState("");
  const [commitBody, setCommitBody] = useState("");
  const [amend, setAmend] = useState(false);
  const [signOff, setSignOff] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");

  useEffect(() => {
    getGitAuthor(workspaceId)
      .then(([name, email]) => {
        setAuthorName(name);
        setAuthorEmail(email);
      })
      .catch(() => {});
  }, [workspaceId]);

  const gravatarUrl = useMemo(() => {
    if (!authorEmail) {
      return null;
    }
    const hash = authorEmail.trim().toLowerCase();

    return `https://www.gravatar.com/avatar/${md5Hex(hash)}?s=64&d=identicon`;
  }, [authorEmail]);

  // Collapse when clicking outside (but not on resize handles)
  useEffect(() => {
    if (!expanded) {
      return;
    }
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        // Don't collapse when interacting with resize handles
        if (target.closest('[role="separator"]')) {
          return;
        }
        setExpanded(false);
      }
    };

    document.addEventListener("mousedown", handleClick);

    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  const handleCommit = useCallback(async () => {
    if (!commitSubject.trim()) {
      return;
    }
    setIsCommitting(true);
    setCommitError(null);
    try {
      let message = commitSubject.trim();
      if (commitBody.trim()) {
        message += `\n\n${commitBody.trim()}`;
      }

      if (signOff && authorName && authorEmail) {
        message += `\n\nSigned-off-by: ${authorName} <${authorEmail}>`;
      }

      await gitCommit(workspaceId, message, amend);
      setCommitSubject("");
      setCommitBody("");
      setAmend(false);
      setExpanded(false);
      onCommitted();
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCommitting(false);
    }
  }, [
    workspaceId,
    commitSubject,
    commitBody,
    amend,
    signOff,
    authorName,
    authorEmail,
    onCommitted,
  ]);

  let commitBtnTitle = "Commit staged changes";
  if (!anyStaged) {
    commitBtnTitle = "No staged changes to commit";
  } else if (!commitSubject.trim()) {
    commitBtnTitle = "Enter a commit subject";
  }

  return (
    <div ref={panelRef} className={styles.commitPanel}>
      <input
        className={styles.commitSubject}
        placeholder="Commit Subject"
        type="text"
        value={commitSubject}
        onChange={(e) => setCommitSubject(e.target.value)}
        onFocus={() => setExpanded(true)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            anyStaged &&
            commitSubject.trim()
          ) {
            handleCommit();
          }
        }}
      />

      {expanded && (
        <>
          <textarea
            className={styles.commitBody}
            placeholder="Detailed description"
            rows={3}
            value={commitBody}
            onChange={(e) => setCommitBody(e.target.value)}
          />
          <div className={styles.hints}>
            <span>· Type &quot;/&quot; for commands</span>
            <span>
              · Hold &quot;Option&quot; key for quick amend while text field is
              not focused
            </span>
          </div>

          <div className={styles.optionsRow}>
            <div className={styles.checkboxes}>
              <label className={styles.checkLabel}>
                <input
                  checked={amend}
                  className={styles.checkbox}
                  type="checkbox"
                  onChange={(e) => setAmend(e.target.checked)}
                />
                Amend
              </label>
              <label className={styles.checkLabel}>
                <input
                  checked={signOff}
                  className={styles.checkbox}
                  type="checkbox"
                  onChange={(e) => setSignOff(e.target.checked)}
                />
                Sign Off
              </label>
            </div>
            {authorName && (
              <div className={styles.authorArea}>
                <div className={styles.authorInfo}>
                  <span className={styles.authorName}>{authorName}</span>
                  <span className={styles.authorEmail}>{authorEmail}</span>
                </div>
                {gravatarUrl && (
                  <img
                    alt={authorName}
                    className={styles.authorAvatar}
                    height={32}
                    src={gravatarUrl}
                    width={32}
                  />
                )}
              </div>
            )}
          </div>
        </>
      )}

      {commitError && <div className={styles.commitError}>{commitError}</div>}
      <div className={styles.commitActions}>
        <button
          className={styles.stageAllBtn}
          onClick={() => onAction(allStaged ? onUnstageAll : onStageAll)}
        >
          {allStaged ? "Unstage All" : "Stage All"}
        </button>
        <button
          className={styles.commitBtn}
          disabled={!anyStaged || !commitSubject.trim() || isCommitting}
          title={commitBtnTitle}
          onClick={handleCommit}
        >
          {isCommitting ? "Committing..." : "Commit"}
        </button>
      </div>
    </div>
  );
}
