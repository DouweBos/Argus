import { useMemo } from "react";
import { Button } from "../Button/Button";
import styles from "./ThreeWayMerge.module.css";

export interface ThreeWayMergeProps {
  /** Base (merge-base) version of the file. */
  base: string;
  /** Current "ours" version. */
  ours: string;
  /** Incoming "theirs" version. */
  theirs: string;
  /** Editable merged buffer (working tree, with conflict markers). */
  merged: string;
  onMergedChange: (text: string) => void;
  /**
   * Resolve a single conflict region by picking ours / theirs / both.
   * The component identifies regions by index in `merged`'s conflict list.
   */
  onResolveRegion?: (
    regionId: string,
    choice: "both" | "ours" | "theirs",
  ) => void;
  /** Mark the file resolved (calls `git add <path>`). */
  onMarkResolved?: () => void;
  readOnly?: boolean;
}

interface ConflictRegion {
  id: string;
  /** Index of the start `<<<<<<<` line. */
  startLine: number;
  /** Index of the end `>>>>>>>` line. */
  endLine: number;
  oursLines: string[];
  theirsLines: string[];
  /** Optional `|||||||` base section for diff3 conflicts. */
  baseLines?: string[];
}

const OURS_MARKER = "<<<<<<<";
const BASE_MARKER = "|||||||";
const SEP_MARKER = "=======";
const THEIRS_MARKER = ">>>>>>>";

/** Parse `<<<<<<< … =======[ … |||||||]… >>>>>>>` regions out of a merged buffer. */
function parseRegions(merged: string): ConflictRegion[] {
  const lines = merged.split("\n");
  const regions: ConflictRegion[] = [];
  let i = 0;
  let regionIdx = 0;
  while (i < lines.length) {
    if (lines[i].startsWith(OURS_MARKER)) {
      const startLine = i;
      const oursLines: string[] = [];
      const theirsLines: string[] = [];
      let baseLines: string[] | undefined;
      i += 1;
      while (
        i < lines.length &&
        !lines[i].startsWith(SEP_MARKER) &&
        !lines[i].startsWith(BASE_MARKER)
      ) {
        oursLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].startsWith(BASE_MARKER)) {
        i += 1;
        baseLines = [];
        while (i < lines.length && !lines[i].startsWith(SEP_MARKER)) {
          baseLines.push(lines[i]);
          i += 1;
        }
      }
      // skip =======
      if (i < lines.length && lines[i].startsWith(SEP_MARKER)) {
        i += 1;
      }
      while (i < lines.length && !lines[i].startsWith(THEIRS_MARKER)) {
        theirsLines.push(lines[i]);
        i += 1;
      }
      const endLine = i;
      i += 1;
      regions.push({
        id: `region-${regionIdx++}`,
        startLine,
        endLine,
        oursLines,
        theirsLines,
        baseLines,
      });
    } else {
      i += 1;
    }
  }

  return regions;
}

/**
 * Replace a region in `merged` with the chosen content. Returns the new
 * full buffer.
 */
export function applyRegionChoice(
  merged: string,
  region: ConflictRegion,
  choice: "both" | "ours" | "theirs",
): string {
  const lines = merged.split("\n");
  let replacement: string[];
  if (choice === "ours") {
    replacement = region.oursLines;
  } else if (choice === "theirs") {
    replacement = region.theirsLines;
  } else {
    replacement = [...region.oursLines, ...region.theirsLines];
  }

  return [
    ...lines.slice(0, region.startLine),
    ...replacement,
    ...lines.slice(region.endLine + 1),
  ].join("\n");
}

export function ThreeWayMerge({
  base,
  ours,
  theirs,
  merged,
  onMergedChange,
  onResolveRegion,
  onMarkResolved,
  readOnly,
}: ThreeWayMergeProps) {
  const regions = useMemo(() => parseRegions(merged), [merged]);

  const handleChoice = (
    region: ConflictRegion,
    choice: "both" | "ours" | "theirs",
  ) => {
    const next = applyRegionChoice(merged, region, choice);
    onMergedChange(next);
    onResolveRegion?.(region.id, choice);
  };

  const allResolved = regions.length === 0;

  return (
    <div className={styles.container}>
      <div className={styles.cols}>
        <ReadOnlyPane label="Ours" content={ours} />
        <ReadOnlyPane label="Base" content={base} />
        <ReadOnlyPane label="Theirs" content={theirs} />
      </div>

      <div className={styles.regionsHeader}>
        <span className={styles.regionsLabel}>
          {allResolved
            ? "All conflict markers cleared"
            : `${regions.length} conflict region${regions.length === 1 ? "" : "s"}`}
        </span>
        {onMarkResolved && (
          <Button
            size="sm"
            variant="primary"
            disabled={readOnly}
            onClick={onMarkResolved}
          >
            Mark resolved
          </Button>
        )}
      </div>

      {regions.map((region) => (
        <div key={region.id} className={styles.region}>
          <div className={styles.regionToolbar}>
            <span className={styles.regionTitle}>
              Lines {region.startLine + 1}–{region.endLine + 1}
            </span>
            <div className={styles.regionActions}>
              <Button
                size="sm"
                variant="secondary"
                disabled={readOnly}
                onClick={() => handleChoice(region, "ours")}
              >
                Take ours
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={readOnly}
                onClick={() => handleChoice(region, "theirs")}
              >
                Take theirs
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={readOnly}
                onClick={() => handleChoice(region, "both")}
              >
                Take both
              </Button>
            </div>
          </div>
          <div className={styles.regionPreview}>
            <div className={styles.regionSide}>
              <div className={styles.regionSideLabel}>ours</div>
              <pre className={styles.regionPre}>
                {region.oursLines.join("\n")}
              </pre>
            </div>
            <div className={styles.regionSide}>
              <div className={styles.regionSideLabel}>theirs</div>
              <pre className={styles.regionPre}>
                {region.theirsLines.join("\n")}
              </pre>
            </div>
          </div>
        </div>
      ))}

      <div className={styles.editorWrapper}>
        <div className={styles.editorLabel}>Merged buffer (editable)</div>
        <textarea
          className={styles.editor}
          value={merged}
          readOnly={readOnly}
          spellCheck={false}
          onChange={(e) => onMergedChange(e.target.value)}
        />
      </div>
    </div>
  );
}

interface ReadOnlyPaneProps {
  label: string;
  content: string;
}

function ReadOnlyPane({ label, content }: ReadOnlyPaneProps) {
  return (
    <div className={styles.pane}>
      <div className={styles.paneLabel}>{label}</div>
      <pre className={styles.panePre}>{content}</pre>
    </div>
  );
}
