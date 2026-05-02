import type { DiffFile, DiffHunk } from "../../../lib/diffParser";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type BlameChunk,
  BlameGutter,
  Button,
  DiffStat,
  Icons,
  ImageDiff,
  type ImageMeta,
} from "@argus/peacock";
import { buildPartialPatch } from "../../../lib/diffParser";
import {
  discardFile,
  discardHunk,
  gitBlameFile,
  gitReadBlobAtRef,
  stageHunk,
  unstageHunk,
} from "../../../lib/ipc";
import { requestFocusCommit } from "../../../stores/gitUiStore";
import { HunkSection } from "../HunkSection";
import styles from "./FileDiffView.module.css";

// ---------------------------------------------------------------------------
// Image extension detection
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "webp",
  "svg",
]);

function extensionOf(filePath: string): string {
  const dot = filePath.lastIndexOf(".");

  return dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : "";
}

function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(filePath));
}

function mimeTypeFor(filePath: string): string {
  const ext = extensionOf(filePath);
  switch (ext) {
    case "svg":
      return "image/svg+xml";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "heic":
      return "image/heic";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function toDataUrl(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`;
}

// ---------------------------------------------------------------------------
// Hook: load before/after image blobs
// ---------------------------------------------------------------------------

interface ImageBlobState {
  afterDataUrl: string | undefined;
  afterMeta: ImageMeta | undefined;
  beforeDataUrl: string | undefined;
  beforeMeta: ImageMeta | undefined;
}

function useImageBlobs(
  sessionId: string,
  file: DiffFile,
): ImageBlobState | null {
  const displayPath = file.newPath || file.oldPath;
  const [state, setState] = useState<ImageBlobState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const mime = mimeTypeFor(displayPath);
    const isAdded = file.status === "A";
    const isDeleted = file.status === "D";

    async function loadMeta(
      dataUrl: string,
    ): Promise<{ height: number; width: number }> {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          resolve({ height: img.naturalHeight, width: img.naturalWidth });
        };
        img.onerror = () => {
          resolve({ height: 0, width: 0 });
        };
        img.src = dataUrl;
      });
    }

    async function load() {
      let beforeDataUrl: string | undefined;
      let afterDataUrl: string | undefined;
      let beforeMeta: ImageMeta | undefined;
      let afterMeta: ImageMeta | undefined;

      if (!isAdded) {
        // "before" = HEAD version of the file
        const b64 = await gitReadBlobAtRef(sessionId, displayPath, "HEAD");
        beforeDataUrl = toDataUrl(b64, mime);
        const dims = await loadMeta(beforeDataUrl);
        beforeMeta = { height: dims.height, width: dims.width };
      }

      if (!isDeleted) {
        // "after" = live worktree file
        const b64 = await gitReadBlobAtRef(sessionId, displayPath, "WORKTREE");
        afterDataUrl = toDataUrl(b64, mime);
        const dims = await loadMeta(afterDataUrl);
        afterMeta = { width: dims.width, height: dims.height };
      }

      if (!cancelled) {
        setState({ beforeDataUrl, afterDataUrl, beforeMeta, afterMeta });
      }
    }

    load().catch(() => {
      if (!cancelled) {
        setState({
          beforeDataUrl: undefined,
          afterDataUrl: undefined,
          beforeMeta: undefined,
          afterMeta: undefined,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId, displayPath, file.status]);

  return state;
}

export interface FileDiffViewProps {
  file: DiffFile;
  /** When true, renders inline (no flex:1, no overflow hidden) for stacking multiple views. */
  inline?: boolean;
  onAction: (action: () => Promise<void>) => Promise<void>;
  /** Hide working-copy actions (Discard/Stage/Unstage). Used when viewing a historical commit. */
  readOnly?: boolean;
  sessionId: string;
}

// Map from hunkIndex -> Set of line indices within that hunk
type LineSelection = Map<number, Set<number>>;

/**
 * Wrapper that remounts the inner component when the file changes,
 * so all local state (view mode, selection) resets automatically.
 */
export function FileDiffView(props: FileDiffViewProps): ReactElement {
  const fileKey = props.file.newPath || props.file.oldPath;
  const isImage = isImagePath(fileKey);

  if (isImage) {
    return <ImageFileDiffView key={fileKey} {...props} />;
  }

  return <FileDiffViewInner key={fileKey} {...props} />;
}

// ---------------------------------------------------------------------------
// Image file diff view
// ---------------------------------------------------------------------------

function ImageFileDiffView({
  file,
  sessionId,
  onAction,
  readOnly = false,
}: FileDiffViewProps): ReactElement {
  const displayPath = file.newPath || file.oldPath;
  const fileName = displayPath.split("/").pop() ?? displayPath;
  const blobs = useImageBlobs(sessionId, file);

  return (
    <div className={styles.fileDiffContainer}>
      {/* File header bar */}
      <div className={styles.fileDiffHeader}>
        <Icons.FileIcon className={styles.fileIcon} />
        <span className={styles.fileDiffName}>{fileName}</span>
        {!readOnly && (
          <div className={styles.fileDiffActions}>
            <Button
              size="sm"
              variant="danger"
              title="Discard all changes to this file"
              onClick={() =>
                onAction(() => discardFile(sessionId, displayPath))
              }
            >
              <Icons.TrashIcon size={11} />
            </Button>
          </div>
        )}
      </div>

      {/* Image diff body */}
      <div className={styles.fileDiffContent}>
        {blobs === null ? (
          <div className={styles.fileDiffStats}>Loading image…</div>
        ) : (
          <ImageDiff
            before={blobs.beforeDataUrl}
            after={blobs.afterDataUrl}
            beforeMeta={blobs.beforeMeta}
            afterMeta={blobs.afterMeta}
          />
        )}
      </div>
    </div>
  );
}

function FileDiffViewInner({
  file,
  sessionId,
  onAction,
  inline,
  readOnly = false,
}: FileDiffViewProps) {
  const displayPath = file.newPath || file.oldPath;
  const fileName = displayPath.split("/").pop() ?? displayPath;

  // Whether each view has content
  const hasStaged = file.staged === "full" || file.staged === "partial";
  const hasUnstaged = file.staged === "none" || file.staged === "partial";

  // View mode: show only staged or only unstaged changes.
  // Raw state tracks user intent; we derive effective mode below.
  const [viewModeRaw, setViewModeRaw] = useState<"staged" | "unstaged">(() =>
    file.staged === "full" ? "staged" : "unstaged",
  );

  // Derive effective mode: auto-switch if current view is empty
  const viewMode = useMemo(() => {
    if (viewModeRaw === "staged" && !hasStaged && hasUnstaged) {
      return "unstaged";
    }
    if (viewModeRaw === "unstaged" && !hasUnstaged && hasStaged) {
      return "staged";
    }

    return viewModeRaw;
  }, [viewModeRaw, hasStaged, hasUnstaged]);

  // Filter hunks based on view mode
  const visibleHunks = useMemo(() => {
    // Fully staged file: "staged" shows everything, "unstaged" shows nothing
    if (file.staged === "full") {
      return viewMode === "staged" ? file.hunks : [];
    }

    // Nothing staged: "unstaged" shows everything, "staged" shows nothing
    if (file.staged === "none") {
      return viewMode === "unstaged" ? file.hunks : [];
    }

    // Partially staged: filter lines
    return file.hunks
      .map((hunk) => {
        const filteredLines = hunk.lines.filter((line) => {
          if (line.type === "context") {
            return true;
          }
          if (viewMode === "staged") {
            return line.staged === true;
          }

          return line.staged !== true;
        });
        const hasChanges = filteredLines.some((l) => l.type !== "context");
        if (!hasChanges) {
          return null;
        }

        return { ...hunk, lines: filteredLines };
      })
      .filter((h): h is DiffHunk => h !== null);
  }, [file, viewMode]);

  const stats = useMemo(() => {
    let adds = 0;
    let removes = 0;
    let chunks = 0;
    for (const h of visibleHunks) {
      chunks++;
      for (const l of h.lines) {
        if (l.type === "add") {
          adds++;
        } else if (l.type === "remove") {
          removes++;
        }
      }
    }

    return { adds, removes, chunks };
  }, [visibleHunks]);

  // Line selection state
  const [selection, setSelection] = useState<LineSelection>(new Map());
  const lastClickRef = useRef<{ hunk: number; line: number } | null>(null);

  // Drag state for gutter selection
  const dragRef = useRef<{
    anchorLine: number;
    /** Selection snapshot before this drag started */
    baseSel: LineSelection;
    hunkIndex: number;
    /** "add" = dragging adds to selection, "remove" = dragging removes */
    mode: "add" | "remove";
  } | null>(null);

  /** Apply a range operation (add or remove) on top of a base selection. */
  const applyRange = useCallback(
    (
      hunkIndex: number,
      from: number,
      to: number,
      base: LineSelection,
      mode: "add" | "remove",
    ) => {
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      const hunkSet = new Set(base.get(hunkIndex) ?? []);
      for (let i = start; i <= end; i++) {
        const l = file.hunks[hunkIndex]?.lines[i];
        if (l && l.type !== "context") {
          if (mode === "add") {
            hunkSet.add(i);
          } else {
            hunkSet.delete(i);
          }
        }
      }

      const next = new Map(base);
      if (hunkSet.size === 0) {
        next.delete(hunkIndex);
      } else {
        next.set(hunkIndex, hunkSet);
      }

      return next;
    },
    [file.hunks],
  );

  const handleGutterMouseDown = useCallback(
    (hunkIndex: number, lineIndex: number, shiftKey: boolean) => {
      const line = file.hunks[hunkIndex]?.lines[lineIndex];
      if (!line || line.type === "context") {
        return;
      }

      if (shiftKey && lastClickRef.current) {
        const lastHunk = lastClickRef.current.hunk;
        const lastLine = lastClickRef.current.line;
        if (lastHunk === hunkIndex) {
          setSelection((prev) =>
            applyRange(hunkIndex, lastLine, lineIndex, prev, "add"),
          );
        }

        return;
      }

      // Determine drag mode from whether anchor is currently selected
      setSelection((prev) => {
        const wasSelected = prev.get(hunkIndex)?.has(lineIndex) ?? false;
        const mode = wasSelected ? "remove" : "add";
        const base = new Map(prev);
        dragRef.current = {
          hunkIndex,
          anchorLine: lineIndex,
          mode,
          baseSel: base,
        };

        return applyRange(hunkIndex, lineIndex, lineIndex, base, mode);
      });

      lastClickRef.current = { hunk: hunkIndex, line: lineIndex };
    },
    [file.hunks, applyRange],
  );

  const handleGutterMouseEnter = useCallback(
    (hunkIndex: number, lineIndex: number) => {
      const drag = dragRef.current;
      if (!drag || drag.hunkIndex !== hunkIndex) {
        return;
      }
      setSelection(
        applyRange(
          hunkIndex,
          drag.anchorLine,
          lineIndex,
          drag.baseSel,
          drag.mode,
        ),
      );
    },
    [applyRange],
  );

  // End drag on mouseup
  useEffect(() => {
    const onMouseUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("mouseup", onMouseUp);

    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  // Phase 4 H7 — toggleable blame gutter for the displayed file.
  const [blameOn, setBlameOn] = useState(false);
  const [blameChunks, setBlameChunks] = useState<BlameChunk[]>([]);
  useEffect(() => {
    if (!blameOn) {
      /* eslint-disable react-hooks/set-state-in-effect --
         Toggle clears the cache so re-enabling triggers a fresh fetch. */
      setBlameChunks([]);
      /* eslint-enable react-hooks/set-state-in-effect */

      return;
    }
    let cancelled = false;
    gitBlameFile(sessionId, displayPath)
      .then((c) => {
        if (!cancelled) {
          setBlameChunks(c);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBlameChunks([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [blameOn, sessionId, displayPath]);

  const clearSelection = useCallback(() => {
    setSelection(new Map());
    lastClickRef.current = null;
  }, []);

  const handleLineAction = useCallback(
    (
      mode: "discard" | "stage" | "unstage",
      hunkIndex: number,
      indices: Set<number>,
    ) => {
      const hunk = file.hunks[hunkIndex];
      if (!hunk) {
        return;
      }
      const patch = buildPartialPatch(file, hunk, indices);
      // Treat the discard as targeting staged content only when every selected
      // line is staged — a mixed selection would fail `git apply --cached
      // --reverse`, and the working-tree reverse alone is the right
      // approximation for the unstaged portion.
      const allSelectedStaged = Array.from(indices).every(
        (i) => hunk.lines[i]?.staged ?? false,
      );
      const action = async () => {
        if (mode === "stage") {
          await stageHunk(sessionId, patch);
        } else if (mode === "unstage") {
          await unstageHunk(sessionId, patch);
        } else {
          await discardHunk(sessionId, patch, allSelectedStaged);
        }

        clearSelection();
      };

      onAction(action);
    },
    [file, sessionId, onAction, clearSelection],
  );

  return (
    <div
      className={`${styles.fileDiffContainer} ${inline ? styles.fileDiffInline : ""}`}
    >
      {/* File header bar */}
      <div className={styles.fileDiffHeader}>
        <Icons.FileIcon className={styles.fileIcon} />
        <span className={styles.fileDiffName}>{fileName}</span>
        <div className={styles.fileDiffActions}>
          {!readOnly && (
            <Button
              size="sm"
              variant="danger"
              title="Discard all changes to this file"
              onClick={() =>
                onAction(() => discardFile(sessionId, displayPath))
              }
            >
              <Icons.TrashIcon size={11} />
            </Button>
          )}
          <Button
            size="sm"
            variant={blameOn ? "primary" : "ghost"}
            title="Toggle blame"
            onClick={() => setBlameOn((b) => !b)}
          >
            Blame
          </Button>
          {!readOnly && (
            <div className={styles.stagedToggle}>
              <button
                className={`${styles.stagedBtn} ${viewMode === "staged" ? styles.stagedBtnActive : ""}`}
                disabled={!hasStaged}
                onClick={() => setViewModeRaw("staged")}
              >
                Staged
              </button>
              <button
                className={`${styles.unstagedBtn} ${viewMode === "unstaged" ? styles.unstagedBtnActive : ""}`}
                disabled={!hasUnstaged}
                onClick={() => setViewModeRaw("unstaged")}
              >
                Unstaged
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats subheader */}
      <div className={styles.fileDiffStats}>
        <span className={styles.chunkCount}>
          {stats.chunks} {stats.chunks === 1 ? "chunk" : "chunks"}
        </span>
        <DiffStat added={stats.adds} removed={stats.removes} />
      </div>

      {blameOn && blameChunks.length > 0 && (
        <div style={{ display: "flex", gap: 0 }}>
          <BlameGutter
            chunks={blameChunks}
            onChunkClick={(hash) => requestFocusCommit(hash)}
          />
        </div>
      )}

      {/* Diff content */}
      <div className={styles.fileDiffContent}>
        {visibleHunks.map((hunk, hi) => (
          <div key={hi} data-hunk-index={hi}>
            <HunkSection
              hunk={hunk}
              hunkIndex={hi}
              readOnly={readOnly}
              selectedLines={selection.get(hi)}
              sessionId={sessionId}
              onAction={onAction}
              onGutterMouseDown={handleGutterMouseDown}
              onGutterMouseEnter={handleGutterMouseEnter}
              onLineAction={handleLineAction}
            />
          </div>
        ))}
      </div>

      {/* Bottom status bar */}
      <div className={styles.fileDiffFooter}>
        <span className={styles.footerChunks}>
          {stats.chunks} {stats.chunks === 1 ? "chunk" : "chunks"}
        </span>
        <DiffStat added={stats.adds} removed={stats.removes} />
      </div>
    </div>
  );
}
