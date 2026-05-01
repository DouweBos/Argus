/**
 * Tiny GitHub remote URL helper used by the commit context menu's
 * "Open on GitHub" item.
 */

export interface GitHubRemote {
  owner: string;
  repo: string;
}

export function parseGitHubRemote(url: string): GitHubRemote | null {
  if (!url) {
    return null;
  }
  // git@github.com:owner/repo.git
  const ssh = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) {
    return { owner: ssh[1]!, repo: ssh[2]! };
  }
  // https://github.com/owner/repo(.git)
  const https = url.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (https) {
    return { owner: https[1]!, repo: https[2]! };
  }
  // ssh://git@github.com/owner/repo(.git)
  const sshFull = url.match(
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
  );
  if (sshFull) {
    return { owner: sshFull[1]!, repo: sshFull[2]! };
  }

  return null;
}

export function commitUrl(remote: GitHubRemote, hash: string): string {
  return `https://github.com/${remote.owner}/${remote.repo}/commit/${hash}`;
}
