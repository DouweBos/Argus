import { useCallback, useEffect, useState } from "react";
import { parsePullRequestUrl } from "@argus/client-core";
import { OpenPullRequestDialog } from "@argus/peacock";
import {
  autofillPrTemplate,
  ghPrCreate,
  gitListLocalBranches,
  pushSessionBranch,
  readPrTemplate,
} from "../../../lib/ipc";
import { appNavigate } from "../../../lib/router";
import { refreshPullRequestList } from "../../../stores/pullRequestStore";
import { useSessionProjects } from "../../../stores/sessionStore";

export interface CreatePullRequestDialogProps {
  /** Session base branch (e.g. "main") — pre-fills the base branch selector. */
  baseBranch: string | null | undefined;
  /** Current branch of this session — pre-fills the head branch selector. */
  headBranch: string;
  /** Initial body content (e.g. from a PR template). */
  initialBody?: string;
  /** Initial title. */
  initialTitle?: string;
  onClose: () => void;
  /** Absolute path to the repo root — passed to gh pr create as cwd. */
  repoRoot: string;
  /** Session id — used to discover local branches and session base branch. */
  sessionId: string;
}

/** The desktop's data behind Peacock's `OpenPullRequestDialog`. */
export function CreatePullRequestDialog({
  initialBody = "",
  initialTitle = "",
  sessionId,
  repoRoot,
  headBranch,
  baseBranch,
  onClose,
}: CreatePullRequestDialogProps) {
  const projects = useSessionProjects();

  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [head, setHead] = useState(headBranch);
  const [base, setBase] = useState(baseBranch ?? "main");
  const [draft, setDraft] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the repo's PR template, never over anything already typed.
  useEffect(() => {
    let cancelled = false;
    readPrTemplate(repoRoot)
      .then((tpl) => {
        if (cancelled || !tpl) {
          return;
        }
        setBody((current) => (current.length > 0 ? current : tpl));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [repoRoot]);

  useEffect(() => {
    let cancelled = false;
    gitListLocalBranches(sessionId)
      .then((list) => {
        if (!cancelled) {
          setBranches(list.map((b) => b.name));
        }
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
      // The head has to exist on the remote first.
      setPushing(true);
      await pushSessionBranch(sessionId);
      setPushing(false);

      const { url } = await ghPrCreate({
        repoRoot,
        title: title.trim(),
        body,
        base,
        head,
        draft,
      });

      const repoRoots = projects.map((p) => p.repoRoot);
      await refreshPullRequestList(repoRoots);

      const pr = parsePullRequestUrl(url);
      onClose();
      if (pr) {
        appNavigate({ view: "pull-request-detail", pr });
      }
    } catch (err) {
      setPushing(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [title, body, base, head, draft, repoRoot, sessionId, onClose, projects]);

  const handleAutofill = useCallback(async () => {
    setAutofilling(true);
    setError(null);
    try {
      const filled = await autofillPrTemplate({
        sessionId,
        title: title.trim() || headBranch,
        baseBranch: base,
      });
      if (filled) {
        setBody(filled);
      } else {
        setError(
          "Auto-fill failed — Claude Code returned no result. Check that `claude` is installed and authenticated.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutofilling(false);
    }
  }, [sessionId, title, headBranch, base]);

  let submitLabel = "Open pull request";
  if (pushing) {
    submitLabel = "Pushing branch…";
  } else if (submitting) {
    submitLabel = "Creating PR…";
  }

  return (
    <OpenPullRequestDialog
      title={title}
      onTitleChange={setTitle}
      body={body}
      onBodyChange={setBody}
      draft={draft}
      onDraftChange={setDraft}
      branches={{
        base,
        head,
        options: branches,
        onBaseChange: setBase,
        onHeadChange: setHead,
      }}
      onFill={() => {
        handleAutofill().catch(() => {});
      }}
      filling={autofilling}
      fillLabel="Auto-fill"
      error={error}
      submitLabel={submitLabel}
      submitting={submitting}
      onSubmit={() => {
        handleSubmit().catch(() => {});
      }}
      onClose={onClose}
    />
  );
}
