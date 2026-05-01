/**
 * Pure helpers to build a tree-by-prefix from a flat enriched-branch list.
 * Kept as plain TS (no React) so it's trivial to test.
 */

import type { EnrichedBranch, RemoteBranch } from "../../../../lib/ipc";

export interface BranchTreeFolder {
  children: BranchTreeNode[];
  kind: "folder";
  name: string;
  /** Path segments leading up to this folder, joined with "/". */
  path: string;
}

export interface BranchTreeLeaf {
  branch: EnrichedBranch;
  /** Full branch name (e.g. "feature/foo"). */
  fullName: string;
  kind: "leaf";
  name: string;
}

export type BranchTreeNode = BranchTreeFolder | BranchTreeLeaf;

/**
 * Build a folder tree of local branches grouped by `/`-separated prefix.
 *
 * `priorityNames` are additional branch names (e.g. the project's
 * `protected_branches` from `.argus.json`) that should sort to the top of
 * the leaf list, after the well-known trunk names.
 */
/**
 * Optional comparator for leaves. When provided, it overrides the default
 * priority-list + alphabetical leaf ordering. Folders still sort
 * alphabetically and leaves still come before folders within a level.
 */
export type LeafComparator = (a: BranchTreeLeaf, b: BranchTreeLeaf) => number;

export function buildLocalTree(
  branches: EnrichedBranch[],
  priorityNames: readonly string[] = [],
  leafComparator?: LeafComparator,
): BranchTreeNode[] {
  const root: BranchTreeFolder = {
    kind: "folder",
    name: "",
    path: "",
    children: [],
  };

  for (const branch of branches) {
    const segments = branch.name.split("/");
    let cursor: BranchTreeFolder = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i] ?? "";
      const path = segments.slice(0, i + 1).join("/");
      let folder = cursor.children.find(
        (c): c is BranchTreeFolder => c.kind === "folder" && c.name === seg,
      );
      if (!folder) {
        folder = { kind: "folder", name: seg, path, children: [] };
        cursor.children.push(folder);
      }
      cursor = folder;
    }
    cursor.children.push({
      kind: "leaf",
      name: segments[segments.length - 1] ?? branch.name,
      fullName: branch.name,
      branch,
    });
  }

  const priorityList = [
    ...DEFAULT_BRANCH_NAMES,
    ...priorityNames.map((n) => n.toLowerCase()),
  ];
  sortInPlace(root, priorityList, leafComparator);

  return root.children;
}

/**
 * Branch names that act as the project's "trunk" — surface these at the very
 * top of the list so the user can find them with no scanning. Order here is
 * the tie-break order when a repo has more than one (rare, but e.g. forks
 * carrying both `main` and `master`).
 */
const DEFAULT_BRANCH_NAMES = [
  "main",
  "master",
  "staging",
  "dev",
  "develop",
  "development",
  "trunk",
  "production",
  "prod",
];

function priorityRank(name: string, priorityList: readonly string[]): number {
  const idx = priorityList.indexOf(name.toLowerCase());

  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function sortInPlace(
  folder: BranchTreeFolder,
  priorityList: readonly string[],
  leafComparator?: LeafComparator,
): void {
  folder.children.sort((a, b) => {
    // Leaves (top-level branches) before folders, so flat branches like
    // `main` and feature branches without a slash sit above grouped folders.
    if (a.kind !== b.kind) {
      return a.kind === "leaf" ? -1 : 1;
    }

    if (a.kind === "leaf" && b.kind === "leaf") {
      const ra = priorityRank(a.name, priorityList);
      const rb = priorityRank(b.name, priorityList);
      if (ra !== rb) {
        return ra - rb;
      }
      if (leafComparator) {
        return leafComparator(a, b);
      }
    }

    return a.name.localeCompare(b.name);
  });
  for (const child of folder.children) {
    if (child.kind === "folder") {
      sortInPlace(child, priorityList, leafComparator);
    }
  }
}

/** Group remote-tracking branches by remote name (origin, upstream, etc.). */
export function groupRemotes(
  branches: RemoteBranch[],
): { branches: RemoteBranch[]; remote: string }[] {
  const map = new Map<string, RemoteBranch[]>();
  for (const b of branches) {
    const key = b.remote || "(unknown)";
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)?.push(b);
  }

  return [...map.entries()]
    .map(([remote, list]) => ({
      remote,
      branches: list.sort((a, b) => a.branchName.localeCompare(b.branchName)),
    }))
    .sort((a, b) => a.remote.localeCompare(b.remote));
}

/** Filter helper: case-insensitive substring match on the branch name. */
export function matchesFilter(name: string, filter: string): boolean {
  if (filter.length === 0) {
    return true;
  }

  return name.toLowerCase().includes(filter.toLowerCase());
}
