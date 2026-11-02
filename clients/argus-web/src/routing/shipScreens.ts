/**
 * Shipping work: a session's branches, one branch, a comparison, its stashes
 * and a commit, plus the pull requests across projects — at the
 * `docs/routing.md` paths the Mac and the phone use.
 */

export type ShipScreen =
  | { name: "branches"; sessionId: string }
  /** `ref` is what git resolves: `origin/x` for a remote-only branch. */
  | { name: "branch"; sessionId: string; ref: string }
  | { name: "compare"; sessionId: string; left: string; right: string }
  | { name: "stashes"; sessionId: string }
  /** `/git/history?commit=`: one commit's diff. */
  | { name: "commit"; sessionId: string; hash: string }
  | { name: "pullRequests" }
  | { name: "pullRequest"; owner: string; repo: string; number: number };

export type ShipScreenName = ShipScreen["name"];

const SHIP_NAMES: ReadonlySet<string> = new Set<ShipScreenName>([
  "branches",
  "branch",
  "compare",
  "stashes",
  "commit",
  "pullRequests",
  "pullRequest",
]);

export function isShipScreen(screen: { name: string }): screen is ShipScreen {
  return SHIP_NAMES.has(screen.name);
}

/** `parts` are the path's decoded segments; `query` its search params. */
export function shipScreenFromParts(
  parts: string[],
  query: URLSearchParams,
): ShipScreen | null {
  if (parts[0] === "pull-requests") {
    if (parts.length === 1) {
      return { name: "pullRequests" };
    }
    const number = Number(parts[3]);
    if (parts.length === 4 && Number.isInteger(number) && number > 0) {
      return { name: "pullRequest", owner: parts[1], repo: parts[2], number };
    }

    return { name: "pullRequests" };
  }
  if (parts[0] !== "sessions" || !parts[1] || parts[2] !== "git") {
    return null;
  }
  const sessionId = parts[1];
  switch (parts[3]) {
    case "branches":
      return parts[4]
        ? { name: "branch", sessionId, ref: parts[4] }
        : { name: "branches", sessionId };
    case "compare": {
      const left = query.get("left");
      const right = query.get("right");

      return left && right
        ? { name: "compare", sessionId, left, right }
        : { name: "branches", sessionId };
    }
    case "stashes":
      return { name: "stashes", sessionId };
    case "history": {
      const hash = query.get("commit");

      return hash && /^[0-9a-f]{4,64}$/i.test(hash)
        ? { name: "commit", sessionId, hash }
        : null;
    }
    case "pull-requests":
      return { name: "pullRequests" };
    default:
      return null;
  }
}

function gitBase(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}/git`;
}

export function shipPath(screen: ShipScreen): string {
  switch (screen.name) {
    case "branches":
      return `${gitBase(screen.sessionId)}/branches`;
    case "branch":
      return `${gitBase(screen.sessionId)}/branches/${encodeURIComponent(screen.ref)}`;
    case "compare":
      return `${gitBase(screen.sessionId)}/compare?${new URLSearchParams({ left: screen.left, right: screen.right }).toString()}`;
    case "stashes":
      return `${gitBase(screen.sessionId)}/stashes`;
    case "commit":
      return `${gitBase(screen.sessionId)}/history?${new URLSearchParams({ commit: screen.hash }).toString()}`;
    case "pullRequests":
      return "/pull-requests";
    case "pullRequest":
      return `/pull-requests/${encodeURIComponent(screen.owner)}/${encodeURIComponent(screen.repo)}/${screen.number}`;
  }
}

/** The route pattern, never a branch, hash or repo. */
export function shipPattern(screen: ShipScreen): string {
  switch (screen.name) {
    case "branches":
      return "/sessions/:sessionId/git/branches";
    case "branch":
      return "/sessions/:sessionId/git/branches/:branchName";
    case "compare":
      return "/sessions/:sessionId/git/compare";
    case "stashes":
      return "/sessions/:sessionId/git/stashes";
    case "commit":
      return "/sessions/:sessionId/git/history";
    case "pullRequests":
      return "/pull-requests";
    case "pullRequest":
      return "/pull-requests/:owner/:repo/:number";
  }
}

/** Where Back goes without in-app history; null is Home. */
export function shipParent(
  screen: ShipScreen,
): ShipScreen | { name: "changes"; sessionId: string; mode: "branch" } | null {
  switch (screen.name) {
    case "branch":
    case "compare":
      return { name: "branches", sessionId: screen.sessionId };
    case "pullRequest":
      return { name: "pullRequests" };
    case "branches":
    case "stashes":
    case "commit":
      return { name: "changes", sessionId: screen.sessionId, mode: "branch" };
    case "pullRequests":
      return null;
  }
}
