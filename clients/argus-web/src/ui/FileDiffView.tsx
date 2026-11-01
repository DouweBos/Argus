/**
 * One file's diff, opened from Changes: the same card, on its own screen,
 * with the way into the file itself.
 */

import { describeError } from "@argus/client-core";
import {
  Button,
  EmptyState,
  FileDiffCard,
  Icons,
  parseDiff,
  Spinner,
} from "@argus/peacock";
import { useCallback, useEffect, useState } from "react";
import { openFile } from "../routing/openFile";
import type { DiffMode } from "../routing/screens";
import { useConnectionStore } from "../stores/connection";
import { useGitStore } from "../stores/git";

const POLL_MS = 5000;

/** The diff card's "View file" action: absent for a file the diff deleted. */
export function ViewFileButton({
  sessionId,
  path,
}: {
  sessionId: string;
  path: string;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      leading={<Icons.CodeIcon size={12} />}
      onClick={() => openFile(sessionId, path, "changes")}
    >
      View file
    </Button>
  );
}

export function FileDiffView({
  sessionId,
  mode,
  path,
}: {
  sessionId: string;
  mode: DiffMode;
  path: string;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const loadDiff = useGitStore((s) => s.loadDiff);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    loadDiff(sessionId, mode)
      .then((r) => {
        setDiff(r.diff);
        setError(null);
      })
      .catch((err: unknown) => setError(describeError(err)));
  }, [sessionId, mode, loadDiff]);

  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    refresh();
    const poll = setInterval(refresh, POLL_MS);

    return () => clearInterval(poll);
  }, [connection, refresh]);

  if (diff === null) {
    return error ? (
      <EmptyState icon={<Icons.BranchIcon size={22} />} title="Can't load the diff" body={error} />
    ) : (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Loading the diff…</span>
      </div>
    );
  }
  const file = parseDiff(diff).find((f) => (f.newPath || f.oldPath) === path);
  if (!file) {
    return (
      <EmptyState
        icon={<Icons.BranchIcon size={22} />}
        title="No changes in this file"
        body={
          mode === "branch"
            ? "It matches the base branch now."
            : "It has no uncommitted changes now."
        }
        action={
          hasControl ? <ViewFileButton sessionId={sessionId} path={path} /> : undefined
        }
      />
    );
  }

  return (
    <div className="aw-changes-files">
      <FileDiffCard
        file={file}
        headerActions={
          hasControl && file.status !== "D" ? (
            <ViewFileButton sessionId={sessionId} path={path} />
          ) : undefined
        }
      />
    </div>
  );
}
