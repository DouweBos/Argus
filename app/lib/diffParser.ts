/**
 * Re-export of the unified-diff parser from `@argus/peacock`. The parser
 * itself lives in the design-system package so any surface that needs to
 * render a diff (session git view, PR files view, etc.) shares the same
 * types and parsing pipeline.
 */

export {
  buildPartialPatch,
  gitIndexPath,
  mergeStaged,
  parseDiff,
} from "@argus/peacock";
export type { DiffFile, DiffHunk, DiffLine } from "@argus/peacock";
