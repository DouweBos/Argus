import { git } from "./git";

/** Names a repo with no `origin/HEAD` most likely treats as its default. */
const FALLBACKS = ["main", "master"];

/** The repo's default branch: what `origin/HEAD` points at, else main/master. */
export async function readDefaultBranch(
  repoRoot: string,
  names: string[],
): Promise<string | null> {
  try {
    const ref = (
      await git(repoRoot, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "refs/remotes/origin/HEAD",
      ])
    ).trim();
    if (ref.startsWith("origin/") && ref.length > "origin/".length) {
      return ref.slice("origin/".length);
    }
  } catch {
    // No remote, or its HEAD was never recorded.
  }

  return FALLBACKS.find((name) => names.includes(name)) ?? null;
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
