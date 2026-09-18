/**
 * List GitHub pull requests of interest to the signed-in `gh` user across
 * repos currently open in Argus.
 *
 * "Of interest" means any of: author, assignee, mentioned, commenter
 * (all covered by GitHub's `involves:` qualifier), direct reviewer
 * (`review-requested:@me`), or team reviewer (`team-review-requested:org/slug`
 * for each of the viewer's teams).
 *
 * Data is fetched in a single `gh api graphql` call. If `gh` is not installed
 * or the user isn't authenticated, we throw a structured error the renderer
 * can surface.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PullRequestReason =
  | "author"
  | "commenter"
  | "mentioned"
  | "reviewer"
  | "team";

export interface InterestingPullRequest {
  author: string | null;
  authorAvatarUrl: string | null;
  baseRefName: string;
  createdAt: string;
  headRefName: string;
  isDraft: boolean;
  number: number;
  reasons: PullRequestReason[];
  repoNameWithOwner: string;
  /** Absolute path of the Argus-open project this PR's repo maps to. */
  repoRoot: string;
  repoUrl: string;
  /** `APPROVED` | `CHANGES_REQUESTED` | `REVIEW_REQUIRED` | null. */
  reviewDecision: string | null;
  title: string;
  updatedAt: string;
  url: string;
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout;
}

/**
 * Resolve *every* GitHub remote for a repo — not just `origin`. When the user
 * has cloned a fork, upstream PRs typically live on the original repo that's
 * configured as a second remote (`upstream`, etc). We want those to show up
 * on the Pull requests screen too.
 */
export async function getGithubSlugs(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoRoot, "remote", "-v"],
      { maxBuffer: 1024 * 1024 },
    );
    const slugs = new Set<string>();
    for (const line of stdout.split("\n")) {
      const parts = line.trim().split(/\s+/);
      const url = parts[1];
      if (!url) {
        continue;
      }
      const match = url.match(
        /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
      );
      if (match) {
        slugs.add(`${match[1]}/${match[2]}`);
      }
    }

    return Array.from(slugs);
  } catch {
    return [];
  }
}

const PR_FIELDS = `
  number
  title
  url
  isDraft
  state
  createdAt
  updatedAt
  reviewDecision
  author { login avatarUrl }
  repository { nameWithOwner url }
  headRefName
  baseRefName
`;

interface PrNode {
  author: { avatarUrl?: string; login?: string } | null;
  baseRefName: string;
  createdAt: string;
  headRefName: string;
  isDraft: boolean;
  number: number;
  repository: { nameWithOwner: string; url: string };
  reviewDecision: string | null;
  state: string;
  title: string;
  updatedAt: string;
  url: string;
}

interface GraphQLResult {
  data: {
    involves: { nodes: PrNode[] };
    reviewRequested: { nodes: PrNode[] };
    viewer: { login: string };
  };
}

async function listUserTeams(): Promise<string[]> {
  try {
    const stdout = await gh([
      "api",
      "user/teams",
      "--paginate",
      "--jq",
      '.[] | .organization.login + "/" + .slug',
    ]);

    return stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    // `read:org` scope may not be granted — fall back gracefully.
    return [];
  }
}

async function searchByTeam(team: string): Promise<PrNode[]> {
  const query = `
    query($q: String!) {
      search(query: $q, type: ISSUE, first: 100) {
        nodes { ... on PullRequest { ${PR_FIELDS} } }
      }
    }
  `;

  try {
    const stdout = await gh([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `q=is:pr is:open archived:false team-review-requested:${team}`,
    ]);
    const parsed = JSON.parse(stdout) as {
      data?: { search?: { nodes?: PrNode[] } };
    };

    return parsed.data?.search?.nodes ?? [];
  } catch {
    return [];
  }
}

/**
 * Return PRs of interest to the signed-in GitHub user, filtered to the given
 * list of Argus-open repo roots.
 */
export async function listInterestingPullRequests(
  repoRoots: string[],
): Promise<InterestingPullRequest[]> {
  // Map repo roots to GitHub `owner/repo` slugs (case-insensitive match later).
  // Every remote counts — a fork project typically has both its own slug and
  // the upstream repo, and PRs can live on either.
  const pairs = await Promise.all(
    repoRoots.map(async (root) => ({
      root,
      slugs: await getGithubSlugs(root),
    })),
  );
  const slugToRoot = new Map<string, string>();
  for (const { root, slugs } of pairs) {
    for (const slug of slugs) {
      // Last-write-wins if two projects happen to share a remote slug;
      // callers only use this for routing the "New session" action, so it
      // doesn't matter which project wins — both are equally valid.
      slugToRoot.set(slug.toLowerCase(), root);
    }
  }
  if (slugToRoot.size === 0) {
    return [];
  }

  const mainQuery = `
    query {
      viewer { login }
      involves: search(query: "is:pr is:open archived:false involves:@me", type: ISSUE, first: 100) {
        nodes { ... on PullRequest { ${PR_FIELDS} } }
      }
      reviewRequested: search(query: "is:pr is:open archived:false user-review-requested:@me", type: ISSUE, first: 100) {
        nodes { ... on PullRequest { ${PR_FIELDS} } }
      }
    }
  `;

  const mainStdout = await gh(["api", "graphql", "-f", `query=${mainQuery}`]);
  const parsed = JSON.parse(mainStdout) as GraphQLResult;
  const viewerLogin = parsed.data.viewer.login;
  const involves = parsed.data.involves.nodes;
  const directReview = parsed.data.reviewRequested.nodes;

  const teams = await listUserTeams();
  const teamResults = await Promise.all(teams.map((t) => searchByTeam(t)));
  const teamPrs = teamResults.flat();

  // Merge by url, combining reasons.
  const byUrl = new Map<
    string,
    { node: PrNode; reasons: Set<PullRequestReason> }
  >();

  const addPrs = (nodes: PrNode[], reason: PullRequestReason) => {
    for (const node of nodes) {
      if (!node || !node.url) {
        continue;
      }
      const slug = node.repository?.nameWithOwner?.toLowerCase();
      if (!slug || !slugToRoot.has(slug)) {
        continue;
      }
      const existing = byUrl.get(node.url);
      if (existing) {
        existing.reasons.add(reason);
      } else {
        byUrl.set(node.url, { node, reasons: new Set([reason]) });
      }
    }
  };

  // The `involves:@me` query covers author/assignee/commenter/mentioned. We
  // refine it per PR below so the UI can label rows accurately.
  addPrs(involves, "commenter");
  addPrs(directReview, "reviewer");
  addPrs(teamPrs, "team");

  const results: InterestingPullRequest[] = [];
  for (const { node, reasons } of byUrl.values()) {
    const slug = node.repository.nameWithOwner.toLowerCase();
    const repoRoot = slugToRoot.get(slug);
    if (!repoRoot) {
      continue;
    }
    const refinedReasons = new Set<PullRequestReason>(reasons);
    if (node.author?.login && node.author.login === viewerLogin) {
      refinedReasons.add("author");
      refinedReasons.delete("commenter");
    }
    if (refinedReasons.has("team")) {
      refinedReasons.delete("reviewer");
    }

    results.push({
      number: node.number,
      title: node.title,
      url: node.url,
      isDraft: node.isDraft,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      reviewDecision: node.reviewDecision ?? null,
      author: node.author?.login ?? null,
      authorAvatarUrl: node.author?.avatarUrl ?? null,
      repoNameWithOwner: node.repository.nameWithOwner,
      repoUrl: node.repository.url,
      headRefName: node.headRefName,
      baseRefName: node.baseRefName,
      repoRoot,
      reasons: Array.from(refinedReasons).sort(),
    });
  }

  results.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return results;
}
