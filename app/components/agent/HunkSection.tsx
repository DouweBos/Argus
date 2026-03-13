import { stageHunk, unstageHunk, discardHunk } from "../../lib/ipc";
import type { DiffHunk } from "../../lib/diffParser";
import styles from "./HunkSection.module.css";

export interface HunkSectionProps {
  hunk: DiffHunk;
  hunkIndex: number;
  onAction: (action: () => Promise<void>) => Promise<void>;
  onGutterMouseDown: (
    hunkIndex: number,
    lineIndex: number,
    shiftKey: boolean,
  ) => void;
  onGutterMouseEnter: (hunkIndex: number, lineIndex: number) => void;
  onLineAction: (
    mode: "discard" | "stage" | "unstage",
    hunkIndex: number,
    indices: Set<number>,
  ) => void;
  selectedLines: Set<number> | undefined;
  workspaceId: string;
}

export function HunkSection({
  hunk,
  hunkIndex,
  workspaceId,
  selectedLines,
  onGutterMouseDown,
  onGutterMouseEnter,
  onLineAction,
  onAction,
}: HunkSectionProps) {
  const hasLocalSelection = selectedLines != null && selectedLines.size > 0;
  const selCount = selectedLines?.size ?? 0;

  return (
    <div className={styles.hunk}>
      <div className={styles.hunkHeader}>
        <span className={styles.hunkHeaderText}>{hunk.header}</span>
        <div
          className={`${styles.hunkActions} ${hasLocalSelection ? styles.hunkActionsVisible : ""}`}
        >
          {hasLocalSelection ? (
            <>
              <button
                className={styles.hunkBtn}
                onClick={() =>
                  onLineAction("discard", hunkIndex, selectedLines!)
                }
              >
                Discard {selCount === 1 ? "Line" : `Lines (${selCount})`}
              </button>
              {hunk.staged ? (
                <button
                  className={styles.hunkBtn}
                  onClick={() =>
                    onLineAction("unstage", hunkIndex, selectedLines!)
                  }
                >
                  Unstage {selCount === 1 ? "Line" : `Lines (${selCount})`}
                </button>
              ) : (
                <button
                  className={styles.hunkBtn}
                  onClick={() =>
                    onLineAction("stage", hunkIndex, selectedLines!)
                  }
                >
                  Stage {selCount === 1 ? "Line" : `Lines (${selCount})`}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                className={styles.hunkBtn}
                onClick={() =>
                  onAction(() => discardHunk(workspaceId, hunk.patch))
                }
              >
                Discard Chunk
              </button>
              {hunk.staged ? (
                <button
                  className={styles.hunkBtn}
                  onClick={() =>
                    onAction(() => unstageHunk(workspaceId, hunk.patch))
                  }
                >
                  Unstage Chunk
                </button>
              ) : (
                <button
                  className={styles.hunkBtn}
                  onClick={() =>
                    onAction(() => stageHunk(workspaceId, hunk.patch))
                  }
                >
                  Stage Chunk
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {hunk.lines.map((line, li) => {
        const isSelected = selectedLines?.has(li) ?? false;
        const isSelectable = line.type !== "context";

        return (
          <div
            key={li}
            className={`${styles.line} ${
              line.type === "add"
                ? styles.lineAdd
                : line.type === "remove"
                  ? styles.lineRemove
                  : ""
            } ${isSelected ? styles.lineSelected : ""} ${line.staged ? styles.lineStaged : ""}`}
          >
            <span
              className={`${styles.lineGutter} ${isSelectable ? styles.lineGutterSelectable : ""} ${isSelected ? styles.lineGutterSelected : ""}`}
              onMouseDown={
                isSelectable
                  ? (e) => {
                      e.preventDefault(); // prevent text selection during drag
                      onGutterMouseDown(hunkIndex, li, e.shiftKey);
                    }
                  : undefined
              }
              onMouseEnter={
                isSelectable
                  ? () => onGutterMouseEnter(hunkIndex, li)
                  : undefined
              }
            >
              <span className={styles.lineNum}>{line.oldNum ?? ""}</span>
              <span className={styles.lineNum}>{line.newNum ?? ""}</span>
            </span>
            <span className={styles.lineText}>
              {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              {line.content || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}
