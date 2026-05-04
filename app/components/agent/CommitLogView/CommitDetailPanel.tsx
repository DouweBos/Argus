import type { DiffFile } from "../../../lib/diffParser";
import type { GitCommit } from "../../../lib/ipc";
import {
  Avatar,
  Button,
  Icons,
  RefBadge,
  SegmentedControl,
} from "@argus/peacock";
import { gravatarUrl as buildGravatarUrl } from "../../../lib/md5";
import { FileDiffView } from "../FileDiffView";
import styles from "../HistoryView/HistoryView.module.css";
import { CommitChangesetFileRow } from "./CommitChangesetFileRow";
import { FileTreeList } from "./FileTreeList";
import {
  classifyRef,
  formatDateTime,
  refDisplayName,
  statusLabel,
} from "./utils";

export interface CommitDetailPanelProps {
  diffFiles: DiffFile[];
  expandedFiles: Set<number>;
  fileStats: { adds: number; dels: number }[];
  filesViewMode: "changeset" | "tree";
  gravatarUrl: string | null;
  onExpandAll: () => void;
  onFilesViewModeChange: (mode: "changeset" | "tree") => void;
  onInteractiveRebaseFromHere: (commit: GitCommit) => void;
  onShaContextMenu: (sha: string, x: number, y: number) => void;
  onToggleFile: (i: number) => void;
  scope: "project" | "session";
  selected: GitCommit;
  sessionId: string;
  tipHash: string | null;
  totalAdds: number;
  totalDels: number;
}

export function CommitDetailPanel({
  diffFiles,
  expandedFiles,
  fileStats,
  filesViewMode,
  gravatarUrl,
  onExpandAll,
  onInteractiveRebaseFromHere,
  onShaContextMenu,
  onToggleFile,
  onFilesViewModeChange,
  scope,
  selected,
  sessionId,
  tipHash,
  totalAdds,
  totalDels,
}: CommitDetailPanelProps) {
  return (
    <div className={styles.detailContent}>
      <div className={styles.detailToolbar}>
        <span className={styles.hashPill}>
          <Avatar
            className={styles.hashPillAvatar}
            name={selected.author}
            size={18}
            src={buildGravatarUrl(selected.authorEmail, 36)}
          />
          <span className={styles.hashPillHash}>
            {selected.abbreviatedHash}
          </span>
        </span>
        <span className={styles.detailToolbarSpacer} />
        <SegmentedControl
          aria-label="File view mode"
          size="sm"
          options={[
            { value: "changeset", label: "Changeset" },
            { value: "tree", label: "Tree" },
          ]}
          value={filesViewMode}
          onChange={onFilesViewModeChange}
        />
      </div>

      <dl className={styles.commitMetaTable}>
        <dt>Authored</dt>
        <dd>{formatDateTime(selected.date)}</dd>
        <dt>Committed</dt>
        <dd>{formatDateTime(selected.committerDate || selected.date)}</dd>
        <dt>Commit</dt>
        <dd
          className={styles.commitMetaMono}
          onContextMenu={(e) => {
            e.preventDefault();
            onShaContextMenu(selected.hash, e.clientX, e.clientY);
          }}
        >
          {selected.hash}
        </dd>
        <dt>Parent</dt>
        <dd
          className={styles.commitMetaMono}
          onContextMenu={(e) => {
            if (!selected.parentHash) {
              return;
            }
            e.preventDefault();
            onShaContextMenu(selected.parentHash, e.clientX, e.clientY);
          }}
        >
          {selected.parentHash}
        </dd>
        {selected.treeHash && (
          <>
            <dt>Tree</dt>
            <dd
              className={styles.commitMetaMono}
              onContextMenu={(e) => {
                e.preventDefault();
                onShaContextMenu(selected.treeHash ?? "", e.clientX, e.clientY);
              }}
            >
              {selected.treeHash}
            </dd>
          </>
        )}
        {selected.refs &&
          (() => {
            const refs = selected.refs
              .split(",")
              .map((r) => r.trim())
              .filter(Boolean);
            if (refs.length === 0) {
              return null;
            }

            return (
              <>
                <dt>Refs</dt>
                <dd className={styles.commitMetaRefs}>
                  {refs.map((r) => {
                    const type = classifyRef(r);

                    return (
                      <RefBadge
                        key={r}
                        name={refDisplayName(r)}
                        type={type}
                        size="sm"
                        current={
                          type === "head" ||
                          (tipHash !== null && selected.hash === tipHash)
                        }
                      />
                    );
                  })}
                </dd>
              </>
            );
          })()}
      </dl>

      <div className={styles.detailHeader}>
        <h2 className={styles.detailTitle}>{selected.subject}</h2>
        {selected.body && (
          <pre className={styles.detailBody}>{selected.body}</pre>
        )}
        <div className={styles.detailAuthorRow}>
          <Avatar
            className={styles.detailAuthorAvatar}
            name={selected.author}
            src={gravatarUrl ?? undefined}
          />
          <div className={styles.detailAuthorInfo}>
            <span className={styles.detailAuthorName}>{selected.author}</span>
            <span className={styles.detailAuthorEmail}>
              &lt;{selected.authorEmail}&gt;
            </span>
          </div>
        </div>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statBlock}>
          <span className={styles.statNum}>{diffFiles.length}</span>
          <span className={styles.statLabel}>
            file{diffFiles.length !== 1 ? "s" : ""} changed
          </span>
        </div>
        <div className={`${styles.statBlock} ${styles.statAdd}`}>
          <span className={styles.statNum}>+{totalAdds}</span>
          <span className={styles.statLabel}>additions</span>
        </div>
        <div className={`${styles.statBlock} ${styles.statDel}`}>
          <span className={styles.statNum}>−{totalDels}</span>
          <span className={styles.statLabel}>deletions</span>
        </div>
      </div>

      <div className={styles.filesHeader}>
        <span className={styles.filesHeaderTitle}>Changed files</span>
        <span className={styles.detailToolbarSpacer} />
        <Button size="sm" variant="ghost" onClick={onExpandAll}>
          Expand All
        </Button>
        {scope === "project" && (
          <Button
            size="sm"
            variant="ghost"
            title="Open interactive rebase using this commit as the upstream boundary"
            onClick={() => onInteractiveRebaseFromHere(selected)}
          >
            Interactive rebase from here
          </Button>
        )}
      </div>

      <div className={styles.filesList}>
        {filesViewMode === "tree" ? (
          <FileTreeList
            diffFiles={diffFiles}
            fileStats={fileStats}
            expandedFiles={expandedFiles}
            onToggle={onToggleFile}
            sessionId={sessionId}
          />
        ) : (
          diffFiles.map((file, i) => {
            const path = file.newPath || file.oldPath;
            const isExpanded = expandedFiles.has(i);
            const stat = fileStats[i] ?? { adds: 0, dels: 0 };

            return (
              <div key={`${path}-${i}`}>
                <CommitChangesetFileRow
                  className={`${styles.fileRow} ${isExpanded ? styles.fileRowExpanded : ""}`}
                  filePath={path}
                  sourceRef={selected.hash}
                  onClick={() => onToggleFile(i)}
                >
                  <span className={styles.fileChevron}>
                    {isExpanded ? (
                      <Icons.ChevronDownIcon size={10} />
                    ) : (
                      <Icons.ChevronRightIcon size={8} />
                    )}
                  </span>
                  <span
                    className={`${styles.fileBadge} ${styles[`badge${file.status}`]}`}
                    title={statusLabel(file.status)}
                  >
                    {file.status}
                  </span>
                  <span className={styles.filePath}>{path}</span>
                  <span className={styles.fileStats}>
                    {stat.adds > 0 && (
                      <span className={styles.fileStatAdd}>+{stat.adds}</span>
                    )}
                    {stat.dels > 0 && (
                      <span className={styles.fileStatDel}>−{stat.dels}</span>
                    )}
                  </span>
                </CommitChangesetFileRow>
                {isExpanded && (
                  <div className={styles.fileDiffInline}>
                    <FileDiffView
                      file={file}
                      inline
                      readOnly
                      sessionId={sessionId}
                      onAction={async () => undefined}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
