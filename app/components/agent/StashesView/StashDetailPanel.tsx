import type { DiffFile } from "../../../lib/diffParser";
import type { GitStashEntry } from "../../../lib/ipc";
import type { ReactNode } from "react";
import { Button, DiffStat, Icons, useDraggable } from "@argus/peacock";
import { FileDiffView } from "../FileDiffView";
import { StashRowActions } from "./StashRowActions";
import styles from "./StashesView.module.css";

export type StashDetailTab = "diff" | "files";

interface StashDetailPanelProps {
  activeTab: StashDetailTab;
  applying: boolean;
  diffFiles: DiffFile[];
  expandedFiles: Set<number>;
  gravatarUrl: string | null;
  onApply: () => void;
  onCreateBranch: (branchName: string) => void;
  onDrop: () => void;
  onExpandAll: () => void;
  onPop: () => void;
  onTabChange: (tab: StashDetailTab) => void;
  onToastDismiss: () => void;
  onToggleFile: (i: number) => void;
  selected: GitStashEntry;
  sessionId: string;
  toast: string | null;
  totalAdds: number;
  totalDels: number;
}

function statusLabel(status: string): string {
  switch (status) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "M":
      return "modified";
    case "R":
      return "renamed";
    default:
      return status;
  }
}

interface StashFileRowProps {
  children: ReactNode;
  className: string;
  filePath: string;
  onClick: () => void;
  sourceRef: string;
}

/**
 * Stash-detail file row, draggable so the working-copy panel can pick it up
 * and restore just this file from the stash.
 */
function StashFileRow({
  children,
  className,
  filePath,
  onClick,
  sourceRef,
}: StashFileRowProps) {
  const drag = useDraggable({
    kind: "file",
    paths: [filePath],
    sourceRef,
  });

  return (
    <button {...drag} className={className} onClick={onClick}>
      {children}
    </button>
  );
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.metaRow}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{value}</span>
    </div>
  );
}

/**
 * Right-side detail pane for the stash list. Renders header metadata,
 * row actions (apply / pop / drop / create branch), tabs (Files | Diff
 * vs Working Copy), and the diff body.
 */
export function StashDetailPanel({
  applying,
  activeTab,
  diffFiles,
  expandedFiles,
  gravatarUrl,
  onApply,
  onCreateBranch,
  onDrop,
  onExpandAll,
  onPop,
  onTabChange,
  onToggleFile,
  onToastDismiss,
  selected,
  sessionId,
  toast,
  totalAdds,
  totalDels,
}: StashDetailPanelProps) {
  return (
    <div className={styles.detailContent}>
      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderRow}>
          <div className={styles.detailMeta}>
            <MetaRow
              label="Author"
              value={
                <>
                  {selected.author} &lt;{selected.authorEmail}&gt;
                </>
              }
            />
            <MetaRow label="Date" value={selected.date} />
            <MetaRow label="Commit Hash" value={selected.hash} />
            <MetaRow label="Parent Hash" value={selected.parentHash} />
          </div>
          {gravatarUrl && (
            <img
              alt={selected.author}
              className={styles.detailAvatar}
              height={48}
              src={gravatarUrl}
              width={48}
            />
          )}
        </div>
        <div className={styles.detailMessage}>{selected.message}</div>
        <StashRowActions
          busy={applying}
          onApply={onApply}
          onPop={onPop}
          onDrop={onDrop}
          onCreateBranch={onCreateBranch}
        />
        {toast && (
          <div className={styles.toastRow}>
            <span>{toast}</span>
            <Button size="sm" variant="ghost" onClick={onToastDismiss}>
              Dismiss
            </Button>
          </div>
        )}
      </div>

      <div className={styles.tabBar} role="tablist">
        <button
          className={`${styles.tab} ${activeTab === "files" ? styles.tabActive : ""}`}
          role="tab"
          aria-selected={activeTab === "files"}
          onClick={() => onTabChange("files")}
        >
          Files
        </button>
        <button
          className={`${styles.tab} ${activeTab === "diff" ? styles.tabActive : ""}`}
          role="tab"
          aria-selected={activeTab === "diff"}
          onClick={() => onTabChange("diff")}
        >
          Diff vs Working Copy
        </button>
      </div>

      {activeTab === "files" && (
        <>
          <div className={styles.filesHeader}>
            <Button size="sm" variant="ghost" onClick={onExpandAll}>
              Expand All
            </Button>
            <span className={styles.filesStats}>
              {diffFiles.length} changed file
              {diffFiles.length !== 1 ? "s" : ""}
            </span>
            <DiffStat added={totalAdds} removed={totalDels} />
          </div>

          <div className={styles.filesList}>
            {diffFiles.map((file, i) => {
              const filePath = file.newPath || file.oldPath;
              const isExpanded = expandedFiles.has(i);

              return (
                <div key={`${filePath}-${i}`}>
                  <StashFileRow
                    className={`${styles.fileRow} ${isExpanded ? styles.fileRowExpanded : ""}`}
                    filePath={filePath}
                    sourceRef={`stash@{${selected.index}}`}
                    onClick={() => onToggleFile(i)}
                  >
                    <span className={styles.fileChevron}>
                      {isExpanded ? (
                        <Icons.ChevronDownIcon size={10} />
                      ) : (
                        <Icons.ChevronRightIcon size={8} />
                      )}
                    </span>
                    <span className={styles.fileStatusLabel}>
                      {statusLabel(file.status)}
                    </span>
                    <span
                      className={`${styles.fileBadge} ${styles[`badge${file.status}`]}`}
                    >
                      {file.status}
                    </span>
                    <span className={styles.filePath}>{filePath}</span>
                  </StashFileRow>
                  {isExpanded && (
                    <div className={styles.fileDiffInline}>
                      <FileDiffView
                        file={file}
                        inline
                        sessionId={sessionId}
                        onAction={async () => {}}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeTab === "diff" && (
        <div className={styles.tabPanel}>
          {diffFiles.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No differences to show</p>
            </div>
          ) : (
            diffFiles.map((file, i) => {
              const filePath = file.newPath || file.oldPath;

              return (
                <FileDiffView
                  key={`${filePath}-${i}`}
                  file={file}
                  inline
                  sessionId={sessionId}
                  onAction={async () => {}}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
