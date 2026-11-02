import type { RemoteGitBranch } from "@argus/remote-protocol";
import type { MouseEvent, ReactNode } from "react";
import { BranchIcon, EllipsisIcon, PinIcon } from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import styles from "./BranchListRow.module.css";

export interface BranchListRowProps {
  branch: RemoteGitBranch;
  onClick?: () => void;
  /** Opens the branch's menu at a point: the row's context menu or its ⋯ button. */
  onMenu?: (position: { x: number; y: number }) => void;
  /** Extra controls before the ⋯ button. */
  trailing?: ReactNode;
}

/** A branch in the list: its name and marks, the last commit, ahead/behind. */
export function BranchListRow({
  branch,
  onClick,
  onMenu,
  trailing,
}: BranchListRowProps) {
  const openMenu = (e: MouseEvent<HTMLElement>) => {
    if (!onMenu) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "contextmenu") {
      onMenu({ x: e.clientX, y: e.clientY });

      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    onMenu({ x: rect.right - 220, y: rect.bottom + 4 });
  };

  return (
    <div className={styles.row} onContextMenu={openMenu}>
      <button
        type="button"
        className={styles.main}
        onClick={onClick}
        disabled={!onClick}
      >
        <BranchIcon size={12} className={styles.icon} />
        <span className={styles.text}>
          <span className={styles.titleLine}>
            <span className={styles.name} title={branch.name}>
              {branch.name}
            </span>
            {branch.pinned && (
              <PinIcon size={10} className={styles.pin} aria-label="Pinned" />
            )}
            {branch.is_current && (
              <Badge tone="accent" size="tag">
                current
              </Badge>
            )}
            {branch.scope === "remote" && (
              <Badge tone="neutral" size="tag">
                {branch.remote ?? "remote"}
              </Badge>
            )}
          </span>
          {branch.last_commit_subject && (
            <span className={styles.subject}>{branch.last_commit_subject}</span>
          )}
        </span>
        {(branch.ahead > 0 || branch.behind > 0) && (
          <span className={styles.counts}>
            {branch.ahead > 0 && <span>↑{branch.ahead}</span>}
            {branch.behind > 0 && <span>↓{branch.behind}</span>}
          </span>
        )}
      </button>
      {trailing}
      {onMenu && (
        <button
          type="button"
          className={styles.menu}
          aria-label={`Actions for ${branch.name}`}
          title="Branch actions"
          onClick={openMenu}
        >
          <EllipsisIcon size={14} />
        </button>
      )}
    </div>
  );
}
