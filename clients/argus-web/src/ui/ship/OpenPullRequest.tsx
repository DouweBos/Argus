/**
 * Open a pull request for a session's branch: a title, the repo's template
 * (or Claude's fill) as the description, draft, then push the branch and
 * open it. The computer works out base and head from the session.
 */

import type { RemoteSession } from "@argus/remote-protocol";
import { useEffect, useState } from "react";
import { baseBranchLabel, describeError } from "@argus/client-core";
import { OpenPullRequestDialog } from "@argus/peacock";
import { pushWork } from "../../stores/land";
import {
  fillPullRequest,
  pullRequestTemplate,
  usePullRequestsStore,
} from "../../stores/pullRequests";

export function OpenPullRequest({
  onClose,
  onOpened,
  session,
}: {
  onClose: () => void;
  onOpened?: (url: string) => void;
  session: Pick<RemoteSession, "base_branch" | "branch" | "id">;
}) {
  const [title, setTitle] = useState(session.branch);
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(true);
  const [busy, setBusy] = useState<"filling" | "opening" | "pushing" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void pullRequestTemplate(session.id).then((template) => {
      if (!cancelled && template) {
        // Never over anything already typed.
        setBody((current) => current || template);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [session.id]);

  const trimmed = title.trim();

  const fill = async () => {
    setBusy("filling");
    setError(null);
    try {
      const filled = await fillPullRequest(session.id, trimmed || session.branch);
      if (filled) {
        setBody(filled);
      } else {
        setError(
          "Claude couldn't fill in the description. Check that `claude` is installed and signed in on the computer.",
        );
      }
    } catch (err) {
      setError(`Couldn't fill in the description — ${describeError(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const open = async () => {
    setError(null);
    setBusy("pushing");
    try {
      await pushWork(session.id);
    } catch (err) {
      setError(`Couldn't push ${session.branch} — ${describeError(err)}`);
      setBusy(null);

      return;
    }
    setBusy("opening");
    try {
      const url = await usePullRequestsStore
        .getState()
        .create(session.id, trimmed, body, draft);
      setCreated(url);
      onOpened?.(url);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  };

  let submitLabel = draft ? "Push and open draft" : "Push and open";
  if (busy === "pushing") {
    submitLabel = "Pushing…";
  } else if (busy === "opening") {
    submitLabel = "Opening…";
  }

  return (
    <OpenPullRequestDialog
      title={title}
      onTitleChange={setTitle}
      body={body}
      onBodyChange={setBody}
      draft={draft}
      onDraftChange={setDraft}
      route={`${session.branch} → ${baseBranchLabel(session.base_branch)}`}
      onFill={() => void fill()}
      filling={busy === "filling"}
      error={error}
      submitLabel={submitLabel}
      submitting={busy === "pushing" || busy === "opening"}
      onSubmit={() => void open()}
      created={
        created
          ? {
              url: created,
              onOpen: () =>
                window.open(created, "_blank", "noopener,noreferrer"),
              onCopy: () =>
                void navigator.clipboard?.writeText(created).catch(() => {}),
            }
          : null
      }
      onClose={onClose}
    />
  );
}
