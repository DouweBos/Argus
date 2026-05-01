import { useCallback, useEffect, useId, useState } from "react";
import { Button, Dialog, Input, TextArea, Toggle } from "@argus/peacock";
import {
  ghPrCreate,
  gitListLocalBranches,
  pushSessionBranch,
} from "../../../lib/ipc";
import { appNavigate } from "../../../lib/router";
import { refreshPullRequestList } from "../../../stores/pullRequestStore";
import { useSessionProjects } from "../../../stores/sessionStore";
import styles from "./CreatePullRequestDialog.module.css";

export interface CreatePullRequestDialogProps {
  /** Initial body content (e.g. from a PR template). */
  /** Session base branch (e.g. "main") — pre-fills the base branch selector. */
  baseBranch: string | null | undefined;
  /** Current branch of this session — pre-fills the head branch selector. */
  headBranch: string;
  initialBody?: string;
  /** Initial title. */
  initialTitle?: string;
  onClose: () => void;
  /** Absolute path to the repo root — passed to gh pr create as cwd. */
  repoRoot: string;
  /** Session id — used to discover local branches and session base branch. */
  sessionId: string;
}

function submitLabel(submitting: boolean): string {
  return submitting ? "Creating PR…" : "Open pull request";
}

export function CreatePullRequestDialog({
  initialBody = "",
  initialTitle = "",
  sessionId,
  repoRoot,
  headBranch,
  baseBranch,
  onClose,
}: CreatePullRequestDialogProps) {
  const titleId = useId();
  const projects = useSessionProjects();

  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [head, setHead] = useState(headBranch);
  const [base, setBase] = useState(baseBranch ?? "main");
  const [draft, setDraft] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load local branch list for the selectors.
  useEffect(() => {
    let cancelled = false;
    gitListLocalBranches(sessionId)
      .then((list) => {
        if (cancelled) {
          return;
        }
        setBranches(list.map((b) => b.name));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) {
      setError("Title is required.");

      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      // Push the head branch first so it exists on the remote.
      setPushing(true);
      await pushSessionBranch(sessionId);
      setPushing(false);

      const { url, number } = await ghPrCreate({
        repoRoot,
        title: title.trim(),
        body,
        base,
        head,
        draft,
      });

      // Invalidate the list cache and refetch so the new PR appears on the
      // Pull Requests screen immediately.
      const repoRoots = projects.map((p) => p.repoRoot);
      await refreshPullRequestList(repoRoots);

      // Parse owner/repo from the PR URL — e.g. https://github.com/owner/repo/pull/1
      const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (match) {
        const [, owner, repo] = match;
        onClose();
        appNavigate({
          view: "pull-request-detail",
          pr: { owner, repo, number },
        });
      } else {
        onClose();
      }
    } catch (err) {
      setPushing(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [title, body, base, head, draft, repoRoot, sessionId, onClose, projects]);

  const busy = submitting;

  return (
    <Dialog
      title="Open pull request"
      titleId={titleId}
      onClose={onClose}
      size="medium"
    >
      <div className={styles.body}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${titleId}-title`}>
            Title
          </label>
          <Input
            id={`${titleId}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Pull request title"
            disabled={busy}
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${titleId}-body`}>
            Description
          </label>
          <TextArea
            id={`${titleId}-body`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a description (optional)"
            rows={6}
            disabled={busy}
          />
        </div>

        <div className={styles.branchRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${titleId}-base`}>
              Base branch
            </label>
            <select
              id={`${titleId}-base`}
              className={styles.select}
              value={base}
              onChange={(e) => setBase(e.target.value)}
              disabled={busy}
            >
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
              {!branches.includes(base) && <option value={base}>{base}</option>}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${titleId}-head`}>
              Head branch
            </label>
            <select
              id={`${titleId}-head`}
              className={styles.select}
              value={head}
              onChange={(e) => setHead(e.target.value)}
              disabled={busy}
            >
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
              {!branches.includes(head) && <option value={head}>{head}</option>}
            </select>
          </div>
        </div>

        <div className={styles.draftRow}>
          <div>
            <div className={styles.draftLabel}>Draft pull request</div>
            <div className={styles.draftSub}>
              Mark as draft to signal it is not ready for review
            </div>
          </div>
          <Toggle checked={draft} onChange={setDraft} disabled={busy} />
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            handleSubmit().catch(() => {});
          }}
          disabled={busy}
        >
          {pushing ? "Pushing branch…" : submitLabel(submitting)}
        </Button>
      </div>
    </Dialog>
  );
}
