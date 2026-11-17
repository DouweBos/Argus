import fs from "node:fs/promises";
import path from "node:path";
import { git } from "./git";

/**
 * Keeps `line` (a root-anchored pattern like `/.argus/design/`) out of git
 * through the repo's shared `info/exclude`, without touching `.gitignore`.
 */
export async function excludeFromGit(
  worktree: string,
  line: string,
): Promise<void> {
  const common = (
    await git(worktree, ["rev-parse", "--git-common-dir"])
  ).trim();
  const exclude = path.resolve(worktree, common, "info", "exclude");
  const current = await fs.readFile(exclude, "utf8").catch(() => "");
  if (!current.split("\n").includes(line)) {
    await fs.mkdir(path.dirname(exclude), { recursive: true });
    await fs.appendFile(
      exclude,
      `${current.endsWith("\n") || !current ? "" : "\n"}${line}\n`,
    );
  }
}
