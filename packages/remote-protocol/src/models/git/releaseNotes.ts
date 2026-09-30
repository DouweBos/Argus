import { z } from "zod";

export const ReleaseNoteLabelTone = z.enum([
  "accent",
  "neutral",
  "success",
  "warning",
]);
export type ReleaseNoteLabelTone = z.infer<typeof ReleaseNoteLabelTone>;

export const ReleaseNoteFormat = z.enum([
  "changesets",
  "json",
  "regex",
  "xml",
  "yaml",
]);
export type ReleaseNoteFormat = z.infer<typeof ReleaseNoteFormat>;

export const ReleaseNoteLabelConfig = z.object({
  /** Display name shown on the badge (e.g. "type", "platform"). */
  name: z.string(),
  /**
   * A regex with one capture group for `format: "regex"`, or a dotted path
   * into the parsed object for `json` / `yaml` / `xml`.
   */
  selector: z.string(),
  /** Optional Peacock badge tone. Defaults to "neutral". */
  tone: ReleaseNoteLabelTone.nullish(),
});
export type ReleaseNoteLabelConfig = z.infer<typeof ReleaseNoteLabelConfig>;

export const ReleaseNotePatternConfig = z.object({
  /** Glob pattern (repo-root relative). Uses git's `:(glob)` pathspec semantics. */
  glob: z.string(),
  /** How to parse the file before extracting labels. */
  format: ReleaseNoteFormat,
  /** Labels to extract and show as Badges. Empty = filename + status only. */
  labels: z.array(ReleaseNoteLabelConfig),
});
export type ReleaseNotePatternConfig = z.infer<typeof ReleaseNotePatternConfig>;

export const ReleaseNoteLabel = z.object({
  name: z.string(),
  value: z.string(),
  tone: ReleaseNoteLabelTone.optional(),
});
export type ReleaseNoteLabel = z.infer<typeof ReleaseNoteLabel>;

export const ReleaseNoteEntry = z.object({
  /** Path relative to the repo root, e.g. `.changeset/silly-cats-dance.md`. */
  filename: z.string(),
  /** Format used to parse this entry — surfaces format-specific UI affordances. */
  format: ReleaseNoteFormat,
  /** Full text content of the file as it lives on this branch (trimmed). */
  content: z.string(),
  /** "added" if the file is new on this branch, "modified" if it existed at the merge-base. */
  status: z.enum(["added", "modified"]),
  /** Labels extracted via the matching pattern's `labels` config. */
  labels: z.array(ReleaseNoteLabel),
});
export type ReleaseNoteEntry = z.infer<typeof ReleaseNoteEntry>;

export const SessionReleaseNotesResult = z.object({
  entries: z.array(ReleaseNoteEntry),
  /** Patterns the project configured in `.argus.json#release_note_patterns`. */
  patterns: z.array(ReleaseNotePatternConfig),
  /** True when the project declares any patterns. False = fall back to changesets. */
  usesReleaseNotes: z.boolean(),
});
export type SessionReleaseNotesResult = z.infer<
  typeof SessionReleaseNotesResult
>;

export const ReleaseNotesPreview = z.object({
  entries: z.array(ReleaseNoteEntry),
});
export type ReleaseNotesPreview = z.infer<typeof ReleaseNotesPreview>;
