/**
 * GitHub's own "Viewed" checkboxes on a pull request's files, so marks made in
 * Argus show on github.com and the other way round.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** `changed`: viewed, then a push touched the file (GitHub's `DISMISSED`). */
export type ViewedState = "changed" | "viewed";

export interface ViewedFile {
  path: string;
  state: ViewedState;
}

interface FilesPage {
  data?: {
    repository?: {
      pullRequest?: {
        id: string;
        files: {
          nodes: { path: string; viewerViewedState: string }[];
          pageInfo: { endCursor: string | null; hasNextPage: boolean };
        };
      } | null;
    };
  };
}

const FILES_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        id
        files(first: 100, after: $after) {
          nodes { path viewerViewedState }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

/** GitHub lists at most 3000 files on a pull request. */
const MAX_PAGES = 30;

const pullRequestIds = new Map<string, string>();

async function graphql(fields: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["api", "graphql", ...fields],
      { maxBuffer: 20 * 1024 * 1024 },
    );

    return stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      throw "gh CLI is not installed. Install it from https://cli.github.com and run `gh auth login`.";
    }
    if (msg.includes("not logged into") || msg.includes("401")) {
      throw "Not authenticated with GitHub. Run `gh auth login` to sign in.";
    }
    throw msg;
  }
}

export function toViewedState(state: string): ViewedState | null {
  if (state === "VIEWED") {
    return "viewed";
  }

  return state === "DISMISSED" ? "changed" : null;
}

export async function getPullRequestViewedFiles(
  owner: string,
  repo: string,
  number: number,
): Promise<ViewedFile[]> {
  const files: ViewedFile[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const fields = [
      "-f",
      `query=${FILES_QUERY}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `repo=${repo}`,
      "-F",
      `number=${number}`,
    ];
    if (after) {
      fields.push("-f", `after=${after}`);
    }
    const parsed = JSON.parse(await graphql(fields)) as FilesPage;
    const pr = parsed.data?.repository?.pullRequest;
    if (!pr) {
      throw `Pull request ${owner}/${repo}#${number} not found`;
    }
    pullRequestIds.set(`${owner}/${repo}#${number}`, pr.id);
    for (const node of pr.files.nodes) {
      const state = toViewedState(node.viewerViewedState);
      if (state) {
        files.push({ path: node.path, state });
      }
    }
    if (!pr.files.pageInfo.hasNextPage) {
      break;
    }
    after = pr.files.pageInfo.endCursor;
  }

  return files;
}

async function pullRequestId(
  owner: string,
  repo: string,
  number: number,
): Promise<string> {
  const key = `${owner}/${repo}#${number}`;
  const cached = pullRequestIds.get(key);
  if (cached) {
    return cached;
  }
  const stdout = await graphql([
    "-f",
    "query=query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { id } } }",
    "-f",
    `owner=${owner}`,
    "-f",
    `repo=${repo}`,
    "-F",
    `number=${number}`,
  ]);
  const id = (JSON.parse(stdout) as FilesPage).data?.repository?.pullRequest
    ?.id;
  if (!id) {
    throw `Pull request ${owner}/${repo}#${number} not found`;
  }
  pullRequestIds.set(key, id);

  return id;
}

export async function setPullRequestFileViewed(params: {
  number: number;
  owner: string;
  path: string;
  repo: string;
  viewed: boolean;
}): Promise<void> {
  const id = await pullRequestId(params.owner, params.repo, params.number);
  const mutation = params.viewed ? "markFileAsViewed" : "unmarkFileAsViewed";
  await graphql([
    "-f",
    `query=mutation($id: ID!, $path: String!) { ${mutation}(input: { pullRequestId: $id, path: $path }) { clientMutationId } }`,
    "-f",
    `id=${id}`,
    "-f",
    `path=${params.path}`,
  ]);
}
