import type { DiffHunk } from "../../../lib/diffParser";
import { discardHunk, stageHunk, unstageHunk } from "../../../lib/ipc";
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
  /** Hide working-copy actions (Discard/Stage/Unstage); used when viewing historical commits. */
  readOnly?: boolean;
  selectedLines: Set<number> | undefined;
  sessionId: string;
}

export function HunkSection({
  hunk,
  hunkIndex,
  sessionId,
  selectedLines,
  onGutterMouseDown,
  onGutterMouseEnter,
  onLineAction,
  onAction,
  readOnly = false,
}: HunkSectionProps) {
  const hasLocalSelection = selectedLines != null && selectedLines.size > 0;
  const selCount = selectedLines?.size ?? 0;

  return (
    <div className={styles.hunk}>
      <div className={styles.hunkHeader}>
        <span className={styles.hunkHeaderText}>{hunk.header}</span>
        {!readOnly && (
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
                    onAction(() => discardHunk(sessionId, hunk.patch))
                  }
                >
                  Discard Chunk
                </button>
                {hunk.staged ? (
                  <button
                    className={styles.hunkBtn}
                    onClick={() =>
                      onAction(() => unstageHunk(sessionId, hunk.patch))
                    }
                  >
                    Unstage Chunk
                  </button>
                ) : (
                  <button
                    className={styles.hunkBtn}
                    onClick={() =>
                      onAction(() => stageHunk(sessionId, hunk.patch))
                    }
                  >
                    Stage Chunk
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {hunk.lines.map((line, li) => {
        if (line.type === "no-newline") {
          return (
            <div key={li} className={`${styles.line} ${styles.lineNoNewline}`}>
              <span className={styles.lineGutter}>
                <span className={styles.lineNum} />
                <span className={styles.lineNum} />
              </span>
              <span className={styles.lineText}>
                ↵ No newline at end of file
              </span>
            </div>
          );
        }

        const isSelected = selectedLines?.has(li) ?? false;
        const isSelectable = !readOnly && line.type !== "context";

        let lineTypeClass = "";
        if (line.type === "add") {
          lineTypeClass = styles.lineAdd;
        } else if (line.type === "remove") {
          lineTypeClass = styles.lineRemove;
        }

        let linePrefix = " ";
        if (line.type === "add") {
          linePrefix = "+";
        } else if (line.type === "remove") {
          linePrefix = "-";
        }

        return (
          <div
            key={li}
            className={`${styles.line} ${lineTypeClass} ${isSelected ? styles.lineSelected : ""} ${line.staged ? styles.lineStaged : ""}`}
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
              {linePrefix}
              {line.content || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}
