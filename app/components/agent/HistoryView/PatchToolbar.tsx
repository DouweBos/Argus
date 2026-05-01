/**
 * Phase 7 T7 — patch import/export toolbar.
 *
 * Sits at the top of the project-scope History view. Export prompts for a
 * range (default `HEAD~1..HEAD`) and writes one patch per commit to OS temp,
 * revealing the result in Finder. Import accepts one or more `.patch`/`.eml`/
 * `.mbox` files via a hidden file input and runs `git am` against them.
 */

import { useRef, useState } from "react";
import {
  Button,
  Dialog,
  GitErrorBanner,
  Input,
  type GitErrorKind,
} from "@argus/peacock";
import { GitError } from "../../../lib/gitError";
import { gitAm, gitFormatPatch, revealInFinder } from "../../../lib/ipc";
import styles from "./PatchToolbar.module.css";

interface Props {
  sessionId: string;
}

interface BannerState {
  kind: GitErrorKind;
  message: string;
}

export function PatchToolbar({ sessionId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [range, setRange] = useState("HEAD~1..HEAD");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<BannerState | null>(null);

  const exportPatches = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const result = await gitFormatPatch(sessionId, { range: range.trim() });
      setExportOpen(false);
      if (result.patchPaths[0]) {
        await revealInFinder(result.patchPaths[0]);
      }
    } catch (err) {
      handleErr(err, setBanner);
    } finally {
      setBusy(false);
    }
  };

  const importPatches = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) {
        continue;
      }
      // Electron preload exposes getFilePath on the File instance.
      const p = window.argus.getFilePath(file);
      if (p) {
        paths.push(p);
      }
    }
    if (paths.length === 0) {
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      await gitAm(sessionId, { patchPaths: paths });
    } catch (err) {
      handleErr(err, setBanner);
    } finally {
      setBusy(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  };

  return (
    <div className={styles.bar}>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => setExportOpen(true)}
      >
        Export as patches
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        Apply patches…
      </Button>
      <input
        ref={fileRef}
        accept=".patch,.eml,.mbox"
        multiple
        type="file"
        className={styles.hiddenInput}
        onChange={(e) => importPatches(e.target.files)}
      />

      {banner && (
        <GitErrorBanner
          kind={banner.kind}
          message={banner.message}
          onDismiss={() => setBanner(null)}
        />
      )}

      {exportOpen && (
        <Dialog
          onClose={() => setExportOpen(false)}
          title="Export commits as patches"
          titleId="patch-export-title"
        >
          <div className={styles.body}>
            <span className={styles.fieldLabel}>Commit range</span>
            <Input
              autoFocus
              mono
              value={range}
              onChange={(e) => setRange(e.target.value)}
              placeholder="HEAD~3..HEAD or main..feature"
            />
            <div className={styles.help}>
              git format-patch will write one .patch file per commit to a
              temporary directory.
            </div>
          </div>
          <div className={styles.footer}>
            <Button variant="secondary" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !range.trim()}
              onClick={exportPatches}
            >
              {busy ? "Exporting…" : "Export"}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function handleErr(err: unknown, setBanner: (b: BannerState) => void): void {
  if (err instanceof GitError) {
    setBanner({ kind: err.kind, message: err.message });
  } else {
    setBanner({
      kind: "unknown",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
