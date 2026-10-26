import type { CliProjectScan } from "../../../lib/types";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  CheckboxRow,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  Spinner,
} from "@argus/peacock";
import {
  defaultSelection,
  formatChatCount,
  formatShortAge,
  truncateMiddle,
} from "../../../lib/cliProjectImport";
import { importCliProjects, scanCliProjects } from "../../../lib/ipc";
import { useFocusedConnection } from "../../../stores/connectionStore";
import {
  hideCliImportDialog,
  useCliImportVisible,
} from "../../../stores/dialogStore";
import { pushError } from "../../../stores/notificationsStore";
import { addRecentProject } from "../../../stores/recentProjectsStore";
import styles from "./CliProjectImportDialog.module.css";

const PATH_MAX = 64;

/** Mounted once by the shell; opened via `showCliImportDialog()`. */
export function CliProjectImportDialog() {
  const visible = useCliImportVisible();

  return visible ? <ImportDialog /> : null;
}

function ImportDialog() {
  const { hostId } = useFocusedConnection();
  const [scan, setScan] = useState<CliProjectScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  // Ages are relative to when the scan landed.
  const [now, setNow] = useState(0);

  useEffect(() => {
    let live = true;
    scanCliProjects()
      .then((result) => {
        if (live) {
          const at = Date.now();
          setNow(at);
          setScan(result);
          setPicked(defaultSelection(result.candidates, at));
        }
      })
      .catch((err: unknown) => {
        if (live) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      live = false;
    };
  }, []);

  const selectable = useMemo(
    () => (scan?.candidates ?? []).filter((c) => !c.added),
    [scan],
  );

  const toggle = (path: string, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(path);
      } else {
        next.delete(path);
      }

      return next;
    });
  };

  const handleImport = async () => {
    const paths = [...picked];
    setImporting(true);
    try {
      await importCliProjects(paths);
      for (const path of paths) {
        addRecentProject(path, hostId);
      }
      hideCliImportDialog();
    } catch (err) {
      pushError(
        err instanceof Error ? err.message : String(err),
        "import_cli_projects",
      );
      setImporting(false);
    }
  };

  const count = picked.size;

  return (
    <Dialog
      title="Import projects from Claude Code"
      titleId="cli-project-import-title"
      size="medium"
      onClose={hideCliImportDialog}
    >
      <DialogBody className={styles.body}>
        <p className={styles.subtitle}>
          Projects you&apos;ve used the Claude Code CLI in, with how many chats
          each has.
        </p>
        {error !== null && <p className={styles.error}>{error}</p>}
        {error === null && scan === null && (
          <div className={styles.loading}>
            <Spinner size="sm" tone="muted" aria-label="Scanning" />
            <span>Looking through your Claude Code chats…</span>
          </div>
        )}
        {scan !== null && scan.candidates.length === 0 && (
          <EmptyState title="No Claude Code projects found" />
        )}
        {scan !== null && scan.candidates.length > 0 && (
          <>
            <div className={styles.header}>
              <span>
                {count} of {selectable.length} selected
              </span>
              <span className={styles.headerActions}>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() =>
                    setPicked(new Set(selectable.map((c) => c.path)))
                  }
                >
                  Select all
                </button>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => setPicked(new Set())}
                >
                  Select none
                </button>
              </span>
            </div>
            <div className={styles.list}>
              {scan.candidates.map((c) => (
                <CheckboxRow
                  key={c.path}
                  checked={c.added || picked.has(c.path)}
                  disabled={c.added || importing}
                  label={c.name}
                  detail={truncateMiddle(c.path, PATH_MAX)}
                  detailTitle={c.path}
                  trailing={
                    c.added ? (
                      "Added"
                    ) : (
                      <>
                        <span>{formatChatCount(c.chat_count)}</span>
                        <span className={styles.age}>
                          {formatShortAge(c.last_active_at, now)}
                        </span>
                      </>
                    )
                  }
                  onChange={(on) => toggle(c.path, on)}
                />
              ))}
            </div>
            {scan.truncated && (
              <p className={styles.note}>
                Only the newest chats were scanned; some projects may be
                missing.
              </p>
            )}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={hideCliImportDialog}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={count === 0 || importing}
          onClick={() => {
            handleImport().catch(() => {});
          }}
        >
          {count === 1 ? "Import 1 project" : `Import ${count} projects`}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
