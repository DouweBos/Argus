import type {
  ReleaseNoteFormat,
  ReleaseNoteLabelTone,
  ReleaseNotePatternConfig,
} from "../../../lib/types";
import { useState } from "react";

export interface ReleaseNoteLabelEntry {
  name: string;
  selector: string;
  /** Empty string = "default tone" (rendered as neutral). */
  tone: ReleaseNoteLabelTone | "";
}

export interface ReleaseNotePatternEntry {
  format: ReleaseNoteFormat;
  glob: string;
  labels: ReleaseNoteLabelEntry[];
}

export function useReleaseNotesListState(initial: ReleaseNotePatternEntry[]) {
  const [items, setItems] = useState<ReleaseNotePatternEntry[]>(initial);
  const add = () =>
    setItems((prev) => [
      ...prev,
      { glob: "", format: "changesets", labels: [] },
    ]);
  const update = <K extends keyof ReleaseNotePatternEntry>(
    i: number,
    field: K,
    val: ReleaseNotePatternEntry[K],
  ) =>
    setItems((prev) =>
      prev.map((entry, idx) =>
        idx === i ? { ...entry, [field]: val } : entry,
      ),
    );
  const remove = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  const addLabel = (i: number) =>
    setItems((prev) =>
      prev.map((entry, idx) =>
        idx === i
          ? {
              ...entry,
              labels: [...entry.labels, { name: "", selector: "", tone: "" }],
            }
          : entry,
      ),
    );
  const updateLabel = <K extends keyof ReleaseNoteLabelEntry>(
    i: number,
    j: number,
    field: K,
    val: ReleaseNoteLabelEntry[K],
  ) =>
    setItems((prev) =>
      prev.map((entry, idx) =>
        idx === i
          ? {
              ...entry,
              labels: entry.labels.map((label, lidx) =>
                lidx === j ? { ...label, [field]: val } : label,
              ),
            }
          : entry,
      ),
    );
  const removeLabel = (i: number, j: number) =>
    setItems((prev) =>
      prev.map((entry, idx) =>
        idx === i
          ? {
              ...entry,
              labels: entry.labels.filter((_, lidx) => lidx !== j),
            }
          : entry,
      ),
    );

  return {
    items,
    setItems,
    add,
    update,
    remove,
    addLabel,
    updateLabel,
    removeLabel,
  };
}

/** Convert dialog entries to the on-disk shape consumed by the backend parser. */
export function entriesToPatternConfig(
  items: ReleaseNotePatternEntry[],
): ReleaseNotePatternConfig[] {
  return items
    .filter((p) => p.glob.trim())
    .map((p) => ({
      glob: p.glob.trim(),
      format: p.format,
      labels: p.labels
        .filter((l) => l.name.trim() && l.selector.trim())
        .map((l) => ({
          name: l.name.trim(),
          selector: l.selector.trim(),
          ...(l.tone ? { tone: l.tone } : {}),
        })),
    }));
}

/** Convert a backend pattern back into the dialog's editable shape. */
export function patternsToEntries(
  patterns: ReleaseNotePatternConfig[] | undefined,
): ReleaseNotePatternEntry[] {
  if (!patterns?.length) {
    return [];
  }

  return patterns.map((p) => ({
    glob: p.glob ?? "",
    format: p.format ?? "changesets",
    labels: (p.labels ?? []).map((l) => ({
      name: l.name ?? "",
      selector: l.selector ?? "",
      tone: l.tone ?? "",
    })),
  }));
}
