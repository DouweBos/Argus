/**
 * Phase 7 T7 — patch import/export via `git format-patch` / `git am`.
 *
 * Export writes to OS temp (or an explicit dir); import accepts an array of
 * absolute paths the renderer collected via `<input type="file">`.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";
import { withGitLock } from "./gitLock";

function requireSession(id: string): { path: string } {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return { path: ws.path };
}

export interface FormatPatchResult {
  patchPaths: string[];
}

export async function gitFormatPatch(
  id: string,
  opts: { outputDir?: string; range: string },
): Promise<FormatPatchResult> {
  const { path: cwd } = requireSession(id);
  if (!opts.range.trim()) {
    throw new GitError("unknown", "Range is required");
  }
  const outDir =
    opts.outputDir && opts.outputDir.trim().length > 0
      ? opts.outputDir
      : await fs.mkdtemp(path.join(os.tmpdir(), "argus-patches-"));
  await fs.mkdir(outDir, { recursive: true });
  const out = await git(cwd, ["format-patch", "-o", outDir, opts.range]);
  // `git format-patch` prints one output path per line.
  const patchPaths = out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((p) => (path.isAbsolute(p) ? p : path.join(cwd, p)));

  return { patchPaths };
}

export async function gitAm(
  id: string,
  opts: { patchPaths: string[] },
): Promise<void> {
  const { path: cwd } = requireSession(id);
  if (!Array.isArray(opts.patchPaths) || opts.patchPaths.length === 0) {
    throw new GitError("unknown", "No patches selected");
  }
  await withGitLock(cwd, async () => {
    await git(cwd, ["am", ...opts.patchPaths]);
  });
}
