import type { DiffFile } from "../../../lib/diffParser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, GitErrorBanner, type GitErrorKind } from "@argus/peacock";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import { GitError } from "../../../lib/gitError";
import {
  type GhIssue,
  type GitCommit,
  getGitAuthor,
  getLastCommitHash,
  getLastCommitMessage,
  getSession,
  ghListIssues,
  gitAmendTip,
  gitCommit,
  gitGetConfig,
  gitLog,
  gitSetConfig,
  pushSessionBranch,
} from "../../../lib/ipc";
import { md5Hex } from "../../../lib/md5";
import { useFocusCommitRequests } from "../../../stores/gitUiStore";
import { showSettingsDialog } from "../../../stores/settingsStore";
import { useGitShortcuts } from "../GitView/useGitShortcuts";
import { CommitComposer } from "./CommitComposer";
import styles from "./CommitPanel.module.css";

/** In-memory cache for GitHub issues per repo root. Expires after 5 min. */
const ghIssueCache = new Map<
  string,
  { fetchedAt: number; issues: GhIssue[] }
>();
const GH_ISSUE_CACHE_TTL_MS = 5 * 60 * 1000;

export interface CommitPanelProps {
  allStaged: boolean;
  anyStaged: boolean;
  /** Optional dirty-file list from the parent DiffViewer for \ completions. */
  diffFiles?: DiffFile[];
  onAction: (action: () => Promise<void>) => Promise<void>;
  onCommitted: () => void;
  onStageAll: () => Promise<void>;
  onUnstageAll: () => Promise<void>;
  sessionId: string;
}

export function CommitPanel({
  sessionId,
  allStaged,
  anyStaged,
  diffFiles = [],
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
  const [commitErrorBanner, setCommitErrorBanner] = useState<{
    kind: GitErrorKind;
    message: string;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const subjectInputRef = useRef<HTMLInputElement>(null);
  const bodyInputRef = useRef<HTMLTextAreaElement>(null);
  const isCommittingRef = useRef(false);
  /** Bumped after each successful commit to trigger a tip-hash refresh effect. */
  const [commitTick, setCommitTick] = useState(0);

  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [gpgSign, setGpgSign] = useState(false);
  const [rewordOpen, setRewordOpen] = useState(false);
  const [hasGithubRemote, setHasGithubRemote] = useState(false);
  const [issueNumber, setIssueNumber] = useState<string | null>(null);
  const [tipHash, setTipHash] = useState<string>("");
  /** Saved subject/body the user had typed before amend prefill, restored on toggle off. */
  const preAmendDraftRef = useRef<{
    body: string;
    subject: string;
  } | null>(null);

  // Autocomplete data feeds.
  const [recentCommits, setRecentCommits] = useState<GitCommit[]>([]);
  const [ghIssues, setGhIssues] = useState<GhIssue[]>([]);

  // Listen for the Shift+Cmd+C focus-commit request from the shortcut layer.
  const onFocusCommit = useCallback(() => {
    const input = subjectInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
    setExpanded(true);
  }, []);
  useFocusCommitRequests(onFocusCommit);

  useEffect(() => {
    let cancelled = false;
    const guard =
      <T,>(fn: (v: T) => void) =>
      (v: T) => {
        if (!cancelled) {
          fn(v);
        }
      };
    getGitAuthor(sessionId)
      .then(
        guard(([name, email]: [string, string]) => {
          setAuthorName(name);
          setAuthorEmail(email);
        }),
      )
      .catch(() => {});
    gitGetConfig(sessionId, "commit.gpgsign")
      .then(guard((v: string | null) => setGpgSign(v === "true")))
      .catch(() => undefined);
    gitGetConfig(sessionId, "remote.origin.url")
      .then(
        guard((url: string | null) =>
          setHasGithubRemote(Boolean(url && /github\.com/.test(url))),
        ),
      )
      .catch(guard(() => setHasGithubRemote(false)));

    // Load recent commits for autocomplete (HEAD only — no other branches or stashes).
    gitLog(sessionId, 50, false)
      .then(guard((commits: GitCommit[]) => setRecentCommits(commits)))
      .catch(guard(() => setRecentCommits([])));

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Tip hash: refreshes on session change AND after every successful commit.
  useEffect(() => {
    let cancelled = false;
    getLastCommitHash(sessionId)
      .then((h) => {
        if (!cancelled) {
          setTipHash(h.slice(0, 8));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTipHash("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, commitTick]);

  // Load GitHub issues (cached, graceful failure).
  useEffect(() => {
    if (!hasGithubRemote) {
      return;
    }
    getSession(sessionId)
      .then((session) => {
        if (!session) {
          return;
        }
        const repoRoot = session.repo_root;
        const cached = ghIssueCache.get(repoRoot);
        if (cached && Date.now() - cached.fetchedAt < GH_ISSUE_CACHE_TTL_MS) {
          setGhIssues(cached.issues);

          return;
        }
        ghListIssues(repoRoot)
          .then((issues) => {
            ghIssueCache.set(repoRoot, { issues, fetchedAt: Date.now() });
            setGhIssues(issues);
          })
          .catch(() => setGhIssues([]));
      })
      .catch(() => setGhIssues([]));
  }, [sessionId, hasGithubRemote]);

  const gravatarUrl = useMemo(() => {
    if (!authorEmail) {
      return null;
    }
    const hash = authorEmail.trim().toLowerCase();

    return `https://www.gravatar.com/avatar/${md5Hex(hash)}?s=64&d=identicon`;
  }, [authorEmail]);

  useOutsideClick(
    panelRef,
    expanded,
    () => setExpanded(false),
    (target) => target.closest('[role="separator"]') !== null,
  );

  const handleCommit = useCallback(
    async (alsoPush?: boolean) => {
      if (!commitSubject.trim()) {
        return;
      }
      if (isCommittingRef.current) {
        return;
      }
      isCommittingRef.current = true;
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

        if (amend) {
          // Use the dedicated amend-tip command so backend safety checks
          // (merge-base, pushed) run consistently.
          await gitAmendTip(sessionId, commitSubject.trim(), commitBody.trim());
        } else {
          await gitCommit(sessionId, message, false);
        }
        if (alsoPush) {
          try {
            await pushSessionBranch(sessionId);
          } catch (pushErr) {
            setCommitError(
              pushErr instanceof Error ? pushErr.message : String(pushErr),
            );
          }
        }
        setCommitSubject("");
        setCommitBody("");
        setAmend(false);
        preAmendDraftRef.current = null;
        setExpanded(false);
        // Refresh the tip hash since we just rewrote/added a commit.
        setCommitTick((n) => n + 1);
        onCommitted();
      } catch (err) {
        if (err instanceof GitError) {
          if (err.kind === "nothing-to-commit") {
            // Race: working tree was already clean (e.g. double-submit, or
            // staged change vanished between disable check and IPC). Treat
            // as a no-op rather than surfacing an error.
            setCommitSubject("");
            setCommitBody("");
            setAmend(false);
            preAmendDraftRef.current = null;
            setExpanded(false);
            onCommitted();
          } else {
            setCommitErrorBanner({ kind: err.kind, message: err.message });
          }
        } else {
          setCommitError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        isCommittingRef.current = false;
        setIsCommitting(false);
      }
    },
    [
      sessionId,
      commitSubject,
      commitBody,
      amend,
      signOff,
      authorName,
      authorEmail,
      onCommitted,
    ],
  );

  let commitBtnTitle = amend ? "Amend tip commit" : "Commit staged changes";
  let commitButtonLabel: string;
  if (isCommitting) {
    commitButtonLabel = amend ? "Amending..." : "Committing...";
  } else {
    commitButtonLabel = amend ? "Amend" : "Commit";
  }
  if (!amend && !anyStaged) {
    commitBtnTitle = "No staged changes to commit";
  } else if (!commitSubject.trim()) {
    commitBtnTitle = "Enter a commit subject";
  }

  const subjectLength = commitSubject.length;
  const subjectWarn = subjectLength > 50;
  const subjectError = subjectLength > 72;

  const handleReword = useCallback(async () => {
    try {
      const last = await getLastCommitMessage(sessionId);
      const [subj, ...rest] = last.split("\n");
      setCommitSubject(subj || "");
      setCommitBody(rest.join("\n").replace(/^\n+/, ""));
      setAmend(true);
      setExpanded(true);
      setRewordOpen(false);
      subjectInputRef.current?.focus();
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId]);

  const prefillFromTip = useCallback(async () => {
    try {
      const last = await getLastCommitMessage(sessionId);
      const [subj, ...rest] = last.split("\n");
      // Save what the user had typed so we can restore it if amend is unchecked.
      preAmendDraftRef.current = {
        subject: commitSubject,
        body: commitBody,
      };
      setCommitSubject(subj || "");
      setCommitBody(rest.join("\n").replace(/^\n+/, ""));
      setExpanded(true);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId, commitSubject, commitBody]);

  const restorePreAmendDraft = useCallback(() => {
    const saved = preAmendDraftRef.current;
    if (saved) {
      setCommitSubject(saved.subject);
      setCommitBody(saved.body);
      preAmendDraftRef.current = null;
    }
  }, []);

  const handleAmendToggle = useCallback(
    (next: boolean) => {
      if (!next) {
        setAmend(false);
        restorePreAmendDraft();

        return;
      }
      setAmend(true);
      prefillFromTip().catch(() => undefined);
    },
    [prefillFromTip, restorePreAmendDraft],
  );

  // Phase 2 W12 — Cmd+Enter / Opt+Cmd+Enter shortcuts. Fire only when the
  // composer is expanded so they don't hijack global Enter combos.
  const shortcutHandlers = useMemo(
    () => ({
      "commit-now": () => {
        if (expanded || document.activeElement === subjectInputRef.current) {
          handleCommit(false);
        }
      },
      "commit-and-push": () => {
        if (expanded || document.activeElement === subjectInputRef.current) {
          handleCommit(true);
        }
      },
      "amend-last": () => handleAmendToggle(!amend),
    }),
    [expanded, handleCommit, handleAmendToggle, amend],
  );
  useGitShortcuts("session", shortcutHandlers);

  const toggleGpgSign = useCallback(
    async (next: boolean) => {
      setGpgSign(next);
      try {
        await gitSetConfig(sessionId, "commit.gpgsign", next ? "true" : "");
      } catch {
        // Best-effort; revert on error.
        setGpgSign(!next);
      }
    },
    [sessionId],
  );

  // Handle subject change — also track issue number hint.
  const handleSubjectChange = useCallback(
    (value: string) => {
      setCommitSubject(value);
      if (hasGithubRemote) {
        const match = value.match(/#(\d+)\s*$/);
        setIssueNumber(match ? (match[1] ?? null) : null);
      }
    },
    [hasGithubRemote],
  );

  return (
    <div ref={panelRef} className={styles.commitPanel}>
      <div className={styles.subjectRow}>
        <CommitComposer
          subject={commitSubject}
          body={commitBody}
          subjectWarn={subjectWarn}
          subjectError={subjectError}
          onSubjectChange={handleSubjectChange}
          onBodyChange={setCommitBody}
          onSubjectFocus={() => setExpanded(true)}
          subjectRef={subjectInputRef}
          bodyRef={bodyInputRef}
          diffFiles={diffFiles}
          recentCommits={recentCommits}
          ghIssues={ghIssues}
          showBody={expanded}
          onSubjectEnter={() => {
            if (anyStaged && commitSubject.trim()) {
              handleCommit(false);
            }
          }}
        />
      </div>

      {expanded && hasGithubRemote && issueNumber && (
        <div className={styles.hints}>
          <span>
            · #{issueNumber} will link issue {issueNumber} on GitHub
          </span>
        </div>
      )}
      {expanded && subjectWarn && (
        <div
          className={subjectError ? styles.rulerError : styles.rulerWarn}
          aria-live="polite"
        >
          {subjectLength}/{subjectError ? 72 : 50} chars
        </div>
      )}

      {expanded && (
        <>
          <div className={styles.hints}>
            <span>
              · Type &quot;\&quot; for files, &quot;c:&quot; for commits,
              &quot;#&quot; for issues
            </span>
            <span>
              · Hold &quot;Option&quot; key for quick amend while text field is
              not focused
            </span>
          </div>

          <div className={styles.optionsRow}>
            <div className={styles.checkboxes}>
              <div className={styles.amendRow}>
                <label className={styles.checkLabel} title="Amend tip commit">
                  <input
                    checked={amend}
                    className={styles.checkbox}
                    type="checkbox"
                    onChange={(e) => handleAmendToggle(e.target.checked)}
                  />
                  {amend && tipHash ? `Amend ${tipHash}` : "Amend"}
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Reword tip commit message"
                  onClick={handleReword}
                >
                  Reword tip
                </Button>
              </div>
              <label className={styles.checkLabel}>
                <input
                  checked={signOff}
                  className={styles.checkbox}
                  type="checkbox"
                  onChange={(e) => setSignOff(e.target.checked)}
                />
                Sign Off
              </label>
              <label className={styles.checkLabel} title="commit.gpgsign">
                <input
                  checked={gpgSign}
                  className={styles.checkbox}
                  type="checkbox"
                  onChange={(e) => toggleGpgSign(e.target.checked)}
                />
                GPG sign
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

      {commitErrorBanner && (
        <GitErrorBanner
          kind={commitErrorBanner.kind}
          message={commitErrorBanner.message}
          onAction={(actionId) => {
            if (actionId === "configure-signing") {
              setCommitErrorBanner(null);
              showSettingsDialog();

              return;
            }
            if (actionId === "copy-stderr") {
              navigator.clipboard
                ?.writeText(commitErrorBanner.message)
                .catch(() => undefined);

              return;
            }
            setCommitErrorBanner(null);
          }}
          onDismiss={() => setCommitErrorBanner(null)}
        />
      )}
      {commitError && <div className={styles.commitError}>{commitError}</div>}
      <div className={styles.commitActions}>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onAction(allStaged ? onUnstageAll : onStageAll)}
        >
          {allStaged ? "Unstage All" : "Stage All"}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={
            (!amend && !anyStaged) || !commitSubject.trim() || isCommitting
          }
          title={commitBtnTitle}
          onClick={() => handleCommit(false)}
        >
          {commitButtonLabel}
        </Button>
      </div>
      {/* Reword UX: clicking "Reword tip" loads the tip's message into the
          composer and flips amend on. The actual modal popup deferred to
          a later phase — current flow uses inline edit. */}
      {rewordOpen && null}
    </div>
  );
}
