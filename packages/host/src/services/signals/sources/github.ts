/**
 * GitHub as a native signal source: issues assigned to you, and pull requests
 * waiting on your review.
 *
 * Runs through the same `gh` CLI the rest of the GitHub service uses, so there
 * is no new auth and no token anywhere. It inherits that service's defensive
 * contract too: `gh` missing, logged out, or rate-limited yields an empty list,
 * never a throw — an automation that fires while you are signed out must
 * produce an empty report, not a failed run.
 */

import type { SignalSource, WorkItem } from "../types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGithubSlugs } from "../../github/pullRequests";
import { collectAllProjects } from "../../mcp/projectDiscovery";
import { GITHUB_SOURCE_ID } from "../sourceIds";

const execFileAsync = promisify(execFile);

/** Fields requested from `gh search`; identical for issues and PRs. */
const SEARCH_FIELDS =
  "number,title,body,state,url,repository,labels,assignees,updatedAt";

const SEARCH_LIMIT = "50";

interface GhSearchItem {
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  url?: string;
  repository?: { nameWithOwner?: string; name?: string };
  labels?: { name?: string }[];
  assignees?: { login?: string }[];
  updatedAt?: string;
}

async function gh(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      maxBuffer: 10 * 1024 * 1024,
    });

    return stdout;
  } catch {
    // gh not installed, not authenticated, offline, rate-limited — all the
    // same answer: we know nothing right now.
    return null;
  }
}

async function search(extraArgs: string[]): Promise<GhSearchItem[]> {
  const stdout = await gh([
    "search",
    ...extraArgs,
    "--state",
    "open",
    "--limit",
    SEARCH_LIMIT,
    "--json",
    SEARCH_FIELDS,
  ]);
  if (stdout === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(stdout.trim() || "[]");

    return Array.isArray(parsed) ? (parsed as GhSearchItem[]) : [];
  } catch {
    return [];
  }
}

/**
 * Map `owner/repo` to a local checkout, so a proposal can name the repo it
 * would be worked in. Built from every project Argus knows about plus the
 * automation's own scope.
 */
async function buildSlugIndex(
  repoRoots: string[],
): Promise<Map<string, string>> {
  const roots = new Set(repoRoots);
  for (const project of collectAllProjects()) {
    roots.add(project.path);
  }

  const index = new Map<string, string>();
  await Promise.all(
    [...roots].map(async (root) => {
      for (const slug of await getGithubSlugs(root)) {
        if (!index.has(slug.toLowerCase())) {
          index.set(slug.toLowerCase(), root);
        }
      }
    }),
  );

  return index;
}

/** Normalize one `gh search` row. Returns null when it is too broken to use. */
export function toWorkItem(
  raw: GhSearchItem,
  kind: WorkItem["kind"],
  slugIndex: Map<string, string>,
): WorkItem | null {
  const slug = raw.repository?.nameWithOwner ?? raw.repository?.name ?? "";
  const number = raw.number;
  if (!slug || typeof number !== "number") {
    return null;
  }

  const updated = raw.updatedAt ? Date.parse(raw.updatedAt) : Number.NaN;

  return {
    source_id: GITHUB_SOURCE_ID,
    external_id: `${slug}#${number}`,
    url: raw.url ?? `https://github.com/${slug}/issues/${number}`,
    title: raw.title ?? "",
    body: raw.body ?? "",
    state: raw.state ?? "open",
    assignee: raw.assignees?.[0]?.login ?? null,
    labels: (raw.labels ?? [])
      .map((l) => l.name)
      .filter((n): n is string => Boolean(n)),
    // GitHub has no priority field; a label-derived one would be guesswork.
    priority: null,
    updated_at: Number.isNaN(updated) ? 0 : updated,
    kind,
    repo_root: slugIndex.get(slug.toLowerCase()) ?? null,
  };
}

export const githubSource: SignalSource = {
  id: GITHUB_SOURCE_ID,
  label: "GitHub",
  mode: "native",

  async isAvailable() {
    return (await gh(["auth", "status"])) !== null;
  },

  async fetchAssigned({ repoRoots }) {
    const [issues, prs, slugIndex] = await Promise.all([
      search(["issues", "--assignee", "@me"]),
      search(["prs", "--review-requested", "@me"]),
      buildSlugIndex(repoRoots),
    ]);

    const items = new Map<string, WorkItem>();
    for (const raw of issues) {
      const item = toWorkItem(raw, "issue", slugIndex);
      if (item) {
        items.set(item.external_id, item);
      }
    }
    for (const raw of prs) {
      const item = toWorkItem(raw, "pull_request", slugIndex);
      if (item) {
        items.set(item.external_id, item);
      }
    }

    return [...items.values()].sort((a, b) => b.updated_at - a.updated_at);
  },
};

export { GITHUB_SOURCE_ID };
