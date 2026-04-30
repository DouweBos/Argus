import type {
  ReleaseNoteEntry,
  ReleaseNoteFormat,
  ReleaseNoteLabelTone,
} from "../../../lib/types";
import { useEffect, useMemo, useState } from "react";
import { Icons, Input } from "@argus/peacock";
import { previewReleaseNotes } from "../../../lib/ipc";
import { SessionReleaseNotesList } from "../../home/SessionReleaseNotesCard/SessionReleaseNotesCard";
import { dialogStyles as styles } from "../../shared/Dialog";
import { GlobPathInput } from "./GlobPathInput";
import sectionStyles from "./SetupConfigDialog.module.css";
import {
  entriesToPatternConfig,
  type ReleaseNoteLabelEntry,
  type ReleaseNotePatternEntry,
  type useReleaseNotesListState,
} from "./releaseNotesFieldState";

const FORMAT_OPTIONS: ReleaseNoteFormat[] = [
  "changesets",
  "regex",
  "json",
  "yaml",
  "xml",
];

const TONE_OPTIONS: (ReleaseNoteLabelTone | "")[] = [
  "",
  "accent",
  "neutral",
  "success",
  "warning",
];

interface ReleaseNotesFieldProps {
  list: ReturnType<typeof useReleaseNotesListState>;
  /** Repo root, used to scan for files when previewing. */
  repoRoot: string;
}

export function ReleaseNotesField({ list, repoRoot }: ReleaseNotesFieldProps) {
  const handleAdd = list.add;

  return (
    <div className={styles.field}>
      {list.items.length === 0 ? (
        <div className={styles.emptyState}>
          <span>No release-note patterns configured</span>
          <button className={styles.addRowBtn} onClick={handleAdd}>
            + Add
          </button>
        </div>
      ) : (
        <div className={sectionStyles.runCommandList}>
          {list.items.map((entry, i) => (
            <ReleaseNoteCard
              key={i}
              entry={entry}
              index={i}
              labelsDisabled={entry.format === "changesets"}
              repoRoot={repoRoot}
              onAddLabel={() => list.addLabel(i)}
              onChangeFormat={(val) => list.update(i, "format", val)}
              onChangeGlob={(val) => list.update(i, "glob", val)}
              onChangeLabel={(j, field, val) =>
                list.updateLabel(i, j, field, val)
              }
              onRemove={() => list.remove(i)}
              onRemoveLabel={(j) => list.removeLabel(i, j)}
            />
          ))}
          <button className={styles.addRowBtn} onClick={handleAdd}>
            + Add
          </button>
        </div>
      )}

      <ReleaseNotesPreview entries={list.items} repoRoot={repoRoot} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Per-pattern card                                                   */
/* ------------------------------------------------------------------ */

interface ReleaseNoteCardProps {
  entry: ReleaseNotePatternEntry;
  index: number;
  labelsDisabled: boolean;
  onAddLabel: () => void;
  onChangeFormat: (val: ReleaseNoteFormat) => void;
  onChangeGlob: (val: string) => void;
  onChangeLabel: <K extends keyof ReleaseNoteLabelEntry>(
    j: number,
    field: K,
    val: ReleaseNoteLabelEntry[K],
  ) => void;
  onRemove: () => void;
  onRemoveLabel: (j: number) => void;
  repoRoot: string;
}

function selectorPlaceholderFor(format: ReleaseNoteFormat): string {
  if (format === "regex") {
    return "^Type:\\s*(.+)$";
  }
  if (format === "changesets") {
    return "n/a — derived from frontmatter";
  }

  return "meta.type";
}

function ReleaseNoteCard({
  entry,
  index,
  labelsDisabled,
  repoRoot,
  onAddLabel,
  onChangeFormat,
  onChangeGlob,
  onChangeLabel,
  onRemove,
  onRemoveLabel,
}: ReleaseNoteCardProps) {
  const fieldId = `setup-rn-${index}`;
  const selectorPlaceholder = selectorPlaceholderFor(entry.format);

  return (
    <div className={sectionStyles.runCommandCard}>
      <div className={sectionStyles.runCommandTopRow}>
        <GlobPathInput
          id={`${fieldId}-glob`}
          placeholder="Glob (e.g. .changeset/*.md)"
          repoRoot={repoRoot}
          style={{ flex: 2, minWidth: 200 }}
          value={entry.glob}
          onChange={onChangeGlob}
        />
        <select
          aria-label="Format"
          className={sectionStyles.releaseNoteSelect}
          value={entry.format}
          onChange={(e) => onChangeFormat(e.target.value as ReleaseNoteFormat)}
        >
          {FORMAT_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button
          aria-label="Remove"
          className={styles.removeBtn}
          onClick={onRemove}
        >
          <Icons.CloseIcon size={12} />
        </button>
      </div>

      {!entry.glob && (
        <p className={styles.helpText}>
          Tip: focus the field and pick an example release note from the
          suggestions — Argus turns it into a <code>directory/*.ext</code> glob
          automatically.
        </p>
      )}

      {labelsDisabled ? (
        <p className={styles.helpText}>
          Labels are derived automatically from the YAML frontmatter (each{" "}
          <code>&quot;package&quot;: bump</code> entry becomes a Badge).
        </p>
      ) : (
        <div className={sectionStyles.releaseNoteLabels}>
          {entry.labels.length === 0 ? (
            <button className={styles.addRowBtn} onClick={onAddLabel}>
              + Add label
            </button>
          ) : (
            <>
              {entry.labels.map((label, j) => (
                <div key={j} className={sectionStyles.releaseNoteLabelRow}>
                  <Input
                    placeholder="name (e.g. type)"
                    style={{ flex: 1, minWidth: 90 }}
                    type="text"
                    value={label.name}
                    onChange={(e) => onChangeLabel(j, "name", e.target.value)}
                  />
                  <Input
                    placeholder={selectorPlaceholder}
                    style={{ flex: 2, minWidth: 160 }}
                    type="text"
                    value={label.selector}
                    onChange={(e) =>
                      onChangeLabel(j, "selector", e.target.value)
                    }
                  />
                  <select
                    aria-label="Tone"
                    className={sectionStyles.releaseNoteSelect}
                    value={label.tone}
                    onChange={(e) =>
                      onChangeLabel(
                        j,
                        "tone",
                        e.target.value as ReleaseNoteLabelTone | "",
                      )
                    }
                  >
                    {TONE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t || "default"}
                      </option>
                    ))}
                  </select>
                  <button
                    aria-label="Remove label"
                    className={styles.removeBtn}
                    onClick={() => onRemoveLabel(j)}
                  >
                    <Icons.CloseIcon size={12} />
                  </button>
                </div>
              ))}
              <button className={styles.addRowBtn} onClick={onAddLabel}>
                + Add label
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Live preview                                                       */
/* ------------------------------------------------------------------ */

interface ReleaseNotesPreviewProps {
  entries: ReleaseNotePatternEntry[];
  repoRoot: string;
}

function ReleaseNotesPreview({ entries, repoRoot }: ReleaseNotesPreviewProps) {
  const patterns = useMemo(() => entriesToPatternConfig(entries), [entries]);
  const patternsKey = useMemo(() => JSON.stringify(patterns), [patterns]);
  const [preview, setPreview] = useState<ReleaseNoteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce IPC calls — every keystroke would otherwise re-glob the repo.
  // The empty-config case is handled in the render path so this effect only
  // ever fires when there's actual work to do (avoids cascading setState).
  useEffect(() => {
    if (!repoRoot || patterns.length === 0) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      previewReleaseNotes(repoRoot, patterns)
        .then((res) => {
          if (cancelled) {
            return;
          }
          setPreview(res.entries);
          setError(null);
        })
        .catch((err) => {
          if (cancelled) {
            return;
          }
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // patternsKey lets us avoid re-running when arrays are identical-by-content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoRoot, patternsKey]);

  // Hide the preview block entirely when nothing is configured — the
  // stale `preview`/`error` state then has no effect on the rendered tree.
  if (patterns.length === 0) {
    return null;
  }

  let body: React.ReactNode;
  if (error) {
    body = <p className={styles.errorMsg}>{error}</p>;
  } else if (preview.length === 0 && !loading) {
    body = (
      <p className={styles.helpText}>
        No files in this repo match these globs yet. Files are only listed on
        the home screen when added/modified on a session branch — the preview
        shows everything in the repo so you can verify the globs.
      </p>
    );
  } else {
    body = (
      <div className={sectionStyles.releaseNotePreviewCard}>
        <SessionReleaseNotesList entries={preview} />
      </div>
    );
  }

  return (
    <div className={sectionStyles.releaseNotePreview}>
      <p className={sectionStyles.releaseNotePreviewLabel}>
        Preview · {preview.length} file{preview.length === 1 ? "" : "s"} matched
        in repo
        {loading ? " · scanning…" : ""}
      </p>
      {body}
    </div>
  );
}
