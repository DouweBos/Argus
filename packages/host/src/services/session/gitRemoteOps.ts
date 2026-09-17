/**
 * Project-root remote management (Phase 6B P8).
 *
 * Listing is read-only and accepts any session id. Mutating ops gate to
 * `kind === "project_root"` and wrap `withGitLock`.
 *
 * The simple `gitGetRemotes` in `./gitRemotes.ts` (used by Phase 2 W10's
 * commit composer GitHub-issue trigger) is preserved for backward compat;
 * this module ships the richer `Remote[]` shape the project-scope view needs.
 */

import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";
import { withGitLock } from "./gitLock";

function requireSession(id: string) {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return ws;
}

function requireProjectScope(id: string): { path: string } {
  const ws = requireSession(id);
  if (ws.kind !== "project_root") {
    throw new GitError(
      "unknown",
      "This operation is only available on the project root",
    );
  }

  return { path: ws.path };
}

export type RemoteScheme = "https" | "other" | "ssh";

export interface ParsedRemoteUrl {
  scheme: RemoteScheme;
  host: string;
  owner?: string;
  repo?: string;
}

export function parseRemoteUrl(url: string): ParsedRemoteUrl {
  // SCP-style: git@github.com:owner/repo.git
  const scp = url.match(/^([^@]+)@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
  if (scp) {
    return {
      scheme: "ssh",
      host: scp[2],
      owner: scp[3],
      repo: scp[4],
    };
  }
  // ssh://user@host/owner/repo[.git]
  const sshUrl = url.match(
    /^ssh:\/\/(?:[^@]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/,
  );
  if (sshUrl) {
    return {
      scheme: "ssh",
      host: sshUrl[1],
      owner: sshUrl[2],
      repo: sshUrl[3],
    };
  }
  // https?://host/owner/repo[.git]
  const httpUrl = url.match(
    /^https?:\/\/(?:[^@]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/,
  );
  if (httpUrl) {
    return {
      scheme: "https",
      host: httpUrl[1],
      owner: httpUrl[2],
      repo: httpUrl[3],
    };
  }

  return { scheme: "other", host: url };
}

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl?: string;
  refs: number;
  scheme: RemoteScheme;
  host: string;
}

export async function gitListRemotes(id: string): Promise<Remote[]> {
  const ws = requireSession(id);
  const raw = await git(ws.path, ["remote", "-v"]);
  const fetch = new Map<string, string>();
  const push = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const m = line.trim().match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!m) {
      continue;
    }
    if (m[3] === "fetch") {
      fetch.set(m[1], m[2]);
    } else {
      push.set(m[1], m[2]);
    }
  }

  // Count refs per remote — cheap via `for-each-ref refs/remotes/<name>/`.
  const remoteList: Remote[] = [];
  for (const [name, url] of fetch) {
    let refs = 0;
    try {
      const out = await git(ws.path, [
        "for-each-ref",
        "--format=%(refname)",
        `refs/remotes/${name}`,
      ]);
      refs = out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0).length;
    } catch {
      // ignore
    }
    const parsed = parseRemoteUrl(url);
    const pushUrl = push.get(name);
    const remote: Remote = {
      name,
      fetchUrl: url,
      refs,
      scheme: parsed.scheme,
      host: parsed.host,
    };
    if (pushUrl && pushUrl !== url) {
      remote.pushUrl = pushUrl;
    }
    remoteList.push(remote);
  }

  return remoteList.sort((a, b) => a.name.localeCompare(b.name));
}

export interface AddRemoteOpts {
  name: string;
  url: string;
}

export async function gitAddRemote(
  id: string,
  opts: AddRemoteOpts,
): Promise<void> {
  const { path } = requireProjectScope(id);
  if (!opts.name.trim() || !opts.url.trim()) {
    throw new GitError("unknown", "Remote name and URL are required");
  }
  await withGitLock(path, async () => {
    await git(path, ["remote", "add", opts.name, opts.url]);
  });
}

export async function gitRemoveRemote(
  id: string,
  opts: { name: string },
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    await git(path, ["remote", "remove", opts.name]);
  });
}

export async function gitRenameRemote(
  id: string,
  opts: { from: string; to: string },
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    await git(path, ["remote", "rename", opts.from, opts.to]);
  });
}

export interface SetRemoteUrlOpts {
  name: string;
  url: string;
  push?: boolean;
}

export async function gitSetRemoteUrl(
  id: string,
  opts: SetRemoteUrlOpts,
): Promise<void> {
  const { path } = requireProjectScope(id);
  const args = ["remote", "set-url"];
  if (opts.push) {
    args.push("--push");
  }
  args.push(opts.name, opts.url);
  await withGitLock(path, async () => {
    await git(path, args);
  });
}

export async function gitPruneRemote(
  id: string,
  opts: { name: string },
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    await git(path, ["remote", "prune", opts.name]);
  });
}
