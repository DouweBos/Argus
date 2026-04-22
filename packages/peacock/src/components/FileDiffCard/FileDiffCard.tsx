import type { DiffFile, DiffHunk } from "../../lib/diff";
import type { HTMLAttributes, ReactNode } from "react";
import { FileIcon } from "../../icons/Icons";
import { DiffStat } from "../DiffStat/DiffStat";
import styles from "./FileDiffCard.module.css";

const STATUS_LABEL: Record<DiffFile["status"], string> = {
  A: "Added",
  D: "Deleted",
  M: "Modified",
  R: "Renamed",
};

export interface FileDiffCardProps extends HTMLAttributes<HTMLElement> {
  file: DiffFile;
  /** Optional action node rendered in the header (stage toggle, view raw, …). */
  headerActions?: ReactNode;
  /** Optional per-hunk action node (stage chunk, discard chunk, …). */
  renderHunkActions?: (hunk: DiffHunk, index: number) => ReactNode;
}

/**
 * Read-only rendering primitive for a single unified-diff file.
 *
 * Takes a parsed `DiffFile` and produces a card with a file header
 * (path / status / +/- totals) and one block per hunk with per-line
 * +/- colouring. Optional `headerActions` / `renderHunkActions` let
 * callers inject interactive overlays (stage/unstage buttons in the
 * session view) without this component knowing about them.
 *
 * Consumers who need a side-effecting file-diff (stage/unstage/discard)
 * should compose this primitive with their own action slot — keeping the
 * pure renderer here and the mutation logic at the call site.
 */
export function FileDiffCard({
  file,
  headerActions,
  renderHunkActions,
  className,
  ...rest
}: FileDiffCardProps) {
  const displayPath = file.newPath || file.oldPath;
  const additions = file.hunks.reduce(
    (n, h) => n + h.lines.filter((l) => l.type === "add").length,
    0,
  );
  const deletions = file.hunks.reduce(
    (n, h) => n + h.lines.filter((l) => l.type === "remove").length,
    0,
  );

  return (
    <article
      className={[styles.card, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      <header className={styles.header}>
        <FileIcon size={13} className={styles.icon} />
        <span className={styles.path} title={displayPath}>
          {displayPath}
        </span>
        <span
          className={styles.status}
          data-status={file.status}
          title={STATUS_LABEL[file.status]}
        >
          {STATUS_LABEL[file.status]}
        </span>
        <DiffStat added={additions} removed={deletions} />
        {headerActions && <div className={styles.actions}>{headerActions}</div>}
      </header>

      {file.hunks.length === 0 ? (
        <p className={styles.empty}>
          No textual diff — binary or metadata-only change.
        </p>
      ) : (
        <div className={styles.body}>
          {file.hunks.map((hunk, i) => (
            <HunkBlock
              key={i}
              hunk={hunk}
              actions={renderHunkActions?.(hunk, i)}
            />
          ))}
        </div>
      )}
    </article>
  );
}

interface HunkBlockProps {
  actions?: ReactNode;
  hunk: DiffHunk;
}

function HunkBlock({ hunk, actions }: HunkBlockProps) {
  return (
    <section className={styles.hunk}>
      <div className={styles.hunkHead}>
        <span className={styles.hunkHeader}>{hunk.header}</span>
        {actions && <div className={styles.hunkActions}>{actions}</div>}
      </div>
      {hunk.lines.map((line, li) => {
        let cls = styles.line;
        let prefix = " ";
        if (line.type === "add") {
          cls = `${styles.line} ${styles.add}`;
          prefix = "+";
        } else if (line.type === "remove") {
          cls = `${styles.line} ${styles.remove}`;
          prefix = "-";
        }

        return (
          <div key={li} className={cls}>
            <span className={styles.gutter}>
              <span className={styles.num}>{line.oldNum ?? ""}</span>
              <span className={styles.num}>{line.newNum ?? ""}</span>
            </span>
            <span className={styles.text}>
              {prefix}
              {line.content || " "}
            </span>
          </div>
        );
      })}
    </section>
  );
}
