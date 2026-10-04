/**
 * One spelling per directory. Git reports worktrees by their real path, so a
 * worktree under `/tmp` comes back as `/private/tmp` on macOS; anything keyed
 * or compared by worktree path has to resolve symlinks the same way first.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * `realpath` of the longest existing prefix plus the rest as written, so a path
 * that isn't created yet (or sits on an unplugged drive) still canonicalizes.
 */
export function canonicalPath(p: string): string {
  const resolved = path.resolve(p);
  const tail: string[] = [];
  let head = resolved;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(head), ...tail.reverse());
    } catch {
      const parent = path.dirname(head);
      if (parent === head) {
        return resolved;
      }
      tail.push(path.basename(head));
      head = parent;
    }
  }
}
