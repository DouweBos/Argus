import type { HostDirectoryListing } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import { Button, DirectoryBrowser } from "@argus/peacock";
import { listHostDirectory } from "../../../lib/ipc";
import styles from "./OpenProjectDialog.module.css";

/**
 * Picks a project root on the *host's* disk. A native open dialog would draw on
 * this Mac and browse the wrong filesystem, so remote mode walks the host's
 * directories over the wire instead.
 */
export function HostProjectBrowser({
  hostLabel,
  onCancel,
  onPick,
}: {
  hostLabel: string;
  onCancel: () => void;
  onPick: (path: string) => void;
}) {
  const [listing, setListing] = useState<HostDirectoryListing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const next = await listHostDirectory(path);
      setListing(next);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const target = selected ?? listing?.path ?? null;

  return (
    <div className={styles.hostBrowser}>
      <p className={styles.hostBrowserHint}>Folders on {hostLabel}</p>
      <DirectoryBrowser
        entries={(listing?.entries ?? []).map((e) => ({
          name: e.name,
          path: e.path,
          isRepo: e.is_repo,
        }))}
        error={error}
        loading={loading}
        parent={listing?.parent ?? null}
        path={listing?.path ?? "…"}
        selectedPath={selected}
        onHome={() => {
          load().catch(() => undefined);
        }}
        onNavigate={(path) => {
          load(path).catch(() => undefined);
        }}
        onSelect={setSelected}
      />
      <div className={styles.hostBrowserActions}>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!target}
          onClick={() => target && onPick(target)}
        >
          Open folder
        </Button>
      </div>
    </div>
  );
}
