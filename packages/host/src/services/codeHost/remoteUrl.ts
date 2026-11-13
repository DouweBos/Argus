/** Which code host a git remote points at, from its URL alone. */

import { githubSlugFromUrl } from "../github/slug";

export type CodeHostKind = "github" | "gitlab";

/** A repository on a code host: `path` is `owner/repo` or a GitLab `group/sub/project`. */
export interface RepoRef {
  host: string;
  kind: CodeHostKind;
  path: string;
}

/** Host and path of an ssh, scp-style or https remote. */
export function remoteHostAndPath(
  url: string,
): { host: string; path: string } | null {
  const trimmed = url.trim();
  const match =
    /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(
      trimmed,
    ) ?? /^(?:[^@/\s]+@)?([^/:\s]+):(?!\/)(.+?)(?:\.git)?\/?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const path = match[2]!.replace(/^\/+/, "");

  return path.includes("/") ? { host: match[1]!.toLowerCase(), path } : null;
}

/**
 * GitLab.com, anything named like a GitLab, and the self-hosted instances
 * `glab` is signed in to.
 */
export function isGitlabHost(
  host: string,
  known: ReadonlySet<string>,
): boolean {
  const h = host.toLowerCase();

  return h === "gitlab.com" || known.has(h) || /(^|[.-])gitlab([.-]|$)/.test(h);
}

export function repoRefFromUrl(
  url: string,
  gitlabHosts: ReadonlySet<string>,
): RepoRef | null {
  const slug = githubSlugFromUrl(url);
  if (slug) {
    return { kind: "github", host: "github.com", path: slug };
  }
  const parsed = remoteHostAndPath(url);
  if (!parsed || !isGitlabHost(parsed.host, gitlabHosts)) {
    return null;
  }

  return { kind: "gitlab", host: parsed.host, path: parsed.path };
}

const GITHUB_PR = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i;
const GITLAB_MR = /^https?:\/\/([^/]+)\/(.+?)\/-\/merge_requests\/(\d+)/i;

/** The repo and number of a pull or merge request from its web URL. */
export function pullRequestFromUrl(
  url: string,
): { number: number; ref: RepoRef } | null {
  const gh = GITHUB_PR.exec(url);
  if (gh) {
    return {
      ref: { kind: "github", host: "github.com", path: gh[1]! },
      number: Number(gh[2]),
    };
  }
  const gl = GITLAB_MR.exec(url);
  if (gl) {
    return {
      ref: { kind: "gitlab", host: gl[1]!.toLowerCase(), path: gl[2]! },
      number: Number(gl[3]),
    };
  }

  return null;
}

function encodeBranch(branch: string): string {
  return encodeURIComponent(branch).replace(/%2F/g, "/");
}

/** The web page that opens a new pull/merge request for `branch`. */
export function newPullRequestUrl(
  ref: RepoRef,
  branch: string,
  base: string | null,
  template?: string | null,
): string {
  if (ref.kind === "gitlab") {
    const params = [
      `merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}`,
      ...(base
        ? [`merge_request%5Btarget_branch%5D=${encodeURIComponent(base)}`]
        : []),
    ];

    return `https://${ref.host}/${ref.path}/-/merge_requests/new?${params.join("&")}`;
  }
  const templateParam =
    template && template.trim().length > 0
      ? `&template=${encodeURIComponent(template.trim())}`
      : "";
  if (base) {
    return `https://github.com/${ref.path}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1${templateParam}`;
  }

  return `https://github.com/${ref.path}/pull/new/${encodeURIComponent(branch)}${
    templateParam ? `?expand=1${templateParam}` : ""
  }`;
}

/** `compare/<branch>?expand=1` for GitHub, the new-MR form for GitLab. */
export function branchCompareUrl(ref: RepoRef, branch: string): string {
  return ref.kind === "gitlab"
    ? newPullRequestUrl(ref, branch, null)
    : `https://github.com/${ref.path}/compare/${encodeBranch(branch)}?expand=1`;
}
