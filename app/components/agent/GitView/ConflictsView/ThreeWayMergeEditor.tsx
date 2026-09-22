import { useCallback, useEffect, useState } from "react";
import {
  Button,
  DialogBody,
  DialogFooter,
  Spinner,
  ThreeWayMerge,
} from "@argus/peacock";
import {
  gitGetConflict,
  gitWriteConflictMerged,
  type ConflictBlobs,
} from "../../../../lib/ipc";
import { Dialog } from "../../../shared/Dialog";
import styles from "./ThreeWayMergeEditor.module.css";

interface ThreeWayMergeEditorProps {
  filePath: string;
  onClose: () => void;
  onMarkResolved: () => void;
  sessionId: string;
}

/**
 * Modal wrapper around the Peacock `<ThreeWayMerge>` primitive. Loads the
 * conflict blobs (`git show :1: :2: :3:`) plus the working-tree merged
 * buffer, lets the user edit, and persists changes via
 * `git_write_conflict_merged`. Mark Resolved propagates up to the parent.
 */
export function ThreeWayMergeEditor({
  filePath,
  sessionId,
  onClose,
  onMarkResolved,
}: ThreeWayMergeEditorProps) {
  const [blobs, setBlobs] = useState<ConflictBlobs | null>(null);
  const [merged, setMerged] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    gitGetConflict(sessionId, filePath)
      .then((b) => {
        if (cancelled) {
          return;
        }
        setBlobs(b);
        setMerged(b.merged);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );

    return () => {
      cancelled = true;
    };
  }, [sessionId, filePath]);

  const handleSaveMerged = useCallback(async (text: string) => {
    setMerged(text);
  }, []);

  const handleMarkResolved = useCallback(async () => {
    setSaving(true);
    try {
      await gitWriteConflictMerged(sessionId, filePath, merged);
      onMarkResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [sessionId, filePath, merged, onMarkResolved]);

  return (
    <Dialog
      size="full"
      title={filePath}
      titleId="three-way-merge-title"
      onClose={onClose}
    >
      <DialogBody flush>
        {!blobs && !error && (
          <div className={styles.loading}>
            <Spinner /> Loading conflict…
          </div>
        )}
        {error && <div className={styles.error}>{error}</div>}
        {blobs && (
          <ThreeWayMerge
            base={blobs.base}
            ours={blobs.ours}
            theirs={blobs.theirs}
            merged={merged}
            onMergedChange={handleSaveMerged}
            onMarkResolved={handleMarkResolved}
          />
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="primary"
          disabled={!blobs || saving}
          onClick={handleMarkResolved}
        >
          {saving ? "Saving…" : "Save & mark resolved"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
