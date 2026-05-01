/**
 * LfsBanners — git-lfs status banners for the working copy view.
 *
 * Extracted from DiffViewer to keep that file under 500 lines.
 */
import { useState } from "react";
import { GitErrorBanner } from "@argus/peacock";
import { gitLfsPull, openExternalUrl, type LfsFiles } from "../../../lib/ipc";

export interface LfsBannersProps {
  lfs: LfsFiles | null;
  onClear: () => void;
  onClearTracked: () => void;
  sessionId: string;
  /** When true, all LFS banners are hidden regardless of auto-detection. */
  suppressLfsWarning?: boolean;
}

export function LfsBanners({
  lfs,
  sessionId,
  onClearTracked,
  onClear,
  suppressLfsWarning,
}: LfsBannersProps) {
  const [pulling, setPulling] = useState(false);

  if (!lfs || suppressLfsWarning) {
    return null;
  }

  // Only nag about a missing git-lfs install when the repo actually uses it
  // — otherwise the banner is just noise on every project.
  if (!lfs.lfsInstalled && lfs.repoUsesLfs) {
    return (
      <GitErrorBanner
        kind="lfs-missing"
        message="git-lfs is not installed"
        recovery="Install git-lfs to handle large-file pointers correctly."
        actions={[
          { id: "install-lfs", label: "Install git-lfs", variant: "primary" },
        ]}
        onAction={(actionId) => {
          if (actionId === "install-lfs") {
            openExternalUrl("https://git-lfs.com/").catch(() => undefined);
          }
        }}
        onDismiss={onClear}
      />
    );
  }

  if (lfs.tracked.length === 0) {
    return null;
  }

  const count = lfs.tracked.length;

  return (
    <GitErrorBanner
      kind="lfs-missing"
      message={`${count} file${count === 1 ? "" : "s"} tracked by git-lfs`}
      recovery="Pull LFS payloads for the working tree."
      actions={[
        {
          id: "retry",
          label: pulling ? "Pulling…" : "Pull LFS files",
          variant: "primary",
        },
      ]}
      onAction={async (actionId) => {
        if (actionId !== "retry") {
          return;
        }
        setPulling(true);
        try {
          await gitLfsPull(sessionId, {});
        } finally {
          setPulling(false);
        }
      }}
      onDismiss={onClearTracked}
    />
  );
}
