/**
 * GitHub as a signal trigger sees it: what was opened in the repos in scope,
 * what is assigned to you or waiting on your review, and where you were
 * @-mentioned. Same `gh` CLI and the same contract as `github.ts` — a failure
 * is an empty list, never a throw.
 */

import type { GhSearchItem } from "./github";
import type { SignalEvent, SignalEventKind, WorkItem } from "../types";
import { getGithubSlugs } from "../../github/pullRequests";
import { buildSlugIndex, gh, search, toWorkItem } from "./github";

const LIST_FIELDS = "number,title,body,state,url,labels,assignees,updatedAt";
const LIST_LIMIT = "30";
/** Each mention costs a comments call, so only the freshest are looked at. */
const MAX_MENTIONS = 10;

let login: Promise<string | null> | null = null;

/** The signed-in `gh` user, cached for the host's life once known. */
function viewerLogin(): Promise<string | null> {
  login ??= gh(["api", "user", "--jq", ".login"]).then((out) => {
    const value = out?.trim() || null;
    if (!value) {
      login = null;
    }

    return value;
  });

  return login;
}

function parseList(stdout: string | null): GhSearchItem[] {
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

/** Open issues or PRs in the repos in scope; nothing when the scope is empty. */
async function opened(
  what: "issue" | "pr",
  repoRoots: string[],
  slugIndex: Map<string, string>,
): Promise<WorkItem[]> {
  const slugs = new Set<string>();
  for (const root of repoRoots) {
    for (const slug of await getGithubSlugs(root)) {
      slugs.add(slug);
    }
  }
  const lists = await Promise.all(
    [...slugs].map(async (slug) =>
      parseList(
        await gh([
          what,
          "list",
          "--repo",
          slug,
          "--state",
          "open",
          "--limit",
          LIST_LIMIT,
          "--json",
          LIST_FIELDS,
        ]),
      ).map((raw) => ({ ...raw, repository: { nameWithOwner: slug } })),
    ),
  );
  const kind = what === "issue" ? "issue" : "pull_request";

  return lists
    .flat()
    .map((raw) => toWorkItem(raw, kind, slugIndex))
    .filter((i): i is WorkItem => i !== null);
}

interface GhComment {
  id?: number;
  body?: string;
  html_url?: string;
  user?: { login?: string };
}

/** The latest comment on an item that mentions `me`, if any. */
async function mentioningComment(
  item: WorkItem,
  me: string,
): Promise<GhComment | null> {
  const [slug, number] = item.external_id.split("#");
  const out = await gh([
    "api",
    `repos/${slug}/issues/${number}/comments?per_page=50`,
  ]);
  const comments = parseList(out) as unknown as GhComment[];
  const needle = `@${me.toLowerCase()}`;

  return (
    comments
      .filter((c) => c.user?.login?.toLowerCase() !== me.toLowerCase())
      .filter((c) => (c.body ?? "").toLowerCase().includes(needle))
      .at(-1) ?? null
  );
}

async function mentions(
  slugIndex: Map<string, string>,
): Promise<SignalEvent[]> {
  const me = await viewerLogin();
  if (!me) {
    return [];
  }
  const items = (await search(["issues", "--mentions", "@me", "--include-prs"]))
    .map((raw) => toWorkItem(raw, "issue", slugIndex))
    .filter((i): i is WorkItem => i !== null)
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, MAX_MENTIONS);

  return Promise.all(
    items.map(async (item): Promise<SignalEvent> => {
      const comment = await mentioningComment(item, me);

      // A mention in the body has no comment; it is one event per item.
      return {
        kind: "mentioned",
        key: `mentioned:${item.external_id}:${comment?.id ?? "body"}`,
        item,
        detail: comment
          ? {
              comment: {
                author: comment.user?.login ?? "someone",
                body: (comment.body ?? "").slice(0, 2000),
                url: comment.html_url ?? item.url,
              },
            }
          : {},
      };
    }),
  );
}

function plain(kind: SignalEventKind, items: WorkItem[]): SignalEvent[] {
  return items.map((item) => ({
    kind,
    key: `${kind}:${item.external_id}`,
    item,
    detail: {},
  }));
}

export async function githubEvents(opts: {
  kinds: SignalEventKind[];
  repoRoots: string[];
}): Promise<SignalEvent[]> {
  const { kinds, repoRoots } = opts;
  const slugIndex = await buildSlugIndex(repoRoots);
  const toItems = (rows: GhSearchItem[], kind: WorkItem["kind"]) =>
    rows
      .map((raw) => toWorkItem(raw, kind, slugIndex))
      .filter((i): i is WorkItem => i !== null);

  const batches = await Promise.all([
    kinds.includes("new_issue")
      ? opened("issue", repoRoots, slugIndex).then((i) => plain("new_issue", i))
      : [],
    kinds.includes("new_pr")
      ? opened("pr", repoRoots, slugIndex).then((i) => plain("new_pr", i))
      : [],
    kinds.includes("assigned")
      ? Promise.all([
          search(["issues", "--assignee", "@me"]),
          search(["prs", "--assignee", "@me"]),
        ]).then(([issues, prs]) =>
          plain("assigned", [
            ...toItems(issues, "issue"),
            ...toItems(prs, "pull_request"),
          ]),
        )
      : [],
    kinds.includes("review_requested")
      ? search(["prs", "--review-requested", "@me"]).then((prs) =>
          plain("review_requested", toItems(prs, "pull_request")),
        )
      : [],
    kinds.includes("mentioned") ? mentions(slugIndex) : [],
  ]);

  return batches.flat();
}
