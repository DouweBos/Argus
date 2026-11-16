import fs from "node:fs";
import path from "node:path";

/** Names a repo with no `origin/HEAD` most likely treats as its default. */
const FALLBACKS = ["main", "master"];

/**
 * The repo's default branch: what `origin/HEAD` points at, else main/master
 * among `names` (or the repo's local branches when omitted). A file read, not
 * a git call: git never packs a symbolic ref, so this stays synchronous.
 */
export function readDefaultBranch(
  repoRoot: string,
  names?: string[],
): string | null {
  const gitDir = path.join(repoRoot, ".git");
  try {
    const head = fs
      .readFileSync(
        path.join(gitDir, "refs", "remotes", "origin", "HEAD"),
        "utf8",
      )
      .trim();
    const match = /^ref: refs\/remotes\/origin\/(.+)$/.exec(head);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // No remote, or its HEAD was never recorded.
  }
  const has = names
    ? (name: string) => names.includes(name)
    : (name: string) => localBranchExists(gitDir, name);

  return FALLBACKS.find(has) ?? null;
}

function localBranchExists(gitDir: string, name: string): boolean {
  if (fs.existsSync(path.join(gitDir, "refs", "heads", name))) {
    return true;
  }
  try {
    return fs
      .readFileSync(path.join(gitDir, "packed-refs"), "utf8")
      .split("\n")
      .some((line) => line.endsWith(` refs/heads/${name}`));
  } catch {
    return false;
  }
}

/** `items` with the default branch (or its `origin/` ref) moved to the front. */
export function defaultBranchFirst<T>(
  items: T[],
  defaultBranch: string | null,
  nameOf: (item: T) => string = String,
): T[] {
  if (!defaultBranch) {
    return items;
  }
  const isDefault = (item: T) => {
    const name = nameOf(item);

    return name === defaultBranch || name === `origin/${defaultBranch}`;
  };
  const first = items.filter(isDefault);

  return first.length === 0
    ? items
    : [...first, ...items.filter((item) => !isDefault(item))];
}
