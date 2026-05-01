/**
 * Project-root tag operations (Phase 6B P7).
 *
 * Read-only listing accepts any session id; mutating ops (`create`, `delete`,
 * `push`) are gated to `kind === "project_root"` and wrap `withGitLock`.
 *
 * `pushed` status is computed by comparing local tag refs against `git
 * ls-remote --tags <remote>`. The remote query is best-effort and short-cached
 * per worktree to keep the list view responsive.
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

export interface GitTag {
  name: string;
  commitHash: string;
  subject: string;
  isAnnotated: boolean;
  tagger?: { name: string; email: string; date: string };
  message?: string;
  /** ISO-strict date the tag was created (annotated tag date or, for
   * lightweight tags, the target commit's committer date). Always populated. */
  creatorDate: string;
  /** `true` if the tag exists on the default remote, `false` if not, `null` if unknown. */
  pushed: boolean | null;
}

const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

const TAG_FORMAT = [
  "%(refname:short)",
  "%(objecttype)",
  "%(objectname)",
  "%(*objectname)",
  "%(contents:subject)",
  "%(taggername)",
  "%(taggeremail)",
  "%(taggerdate:iso-strict)",
  "%(contents:body)",
  "%(creatordate:iso-strict)",
].join(FIELD_SEP);

interface RemoteCacheEntry {
  expiresAt: number;
  tags: Set<string>;
}

const remoteTagCache = new Map<string, RemoteCacheEntry>();
const REMOTE_CACHE_MS = 60_000;

async function loadRemoteTags(
  cwd: string,
  remote: string,
): Promise<Set<string> | null> {
  const cacheKey = `${cwd}|${remote}`;
  const now = Date.now();
  const hit = remoteTagCache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return hit.tags;
  }
  try {
    const out = await git(cwd, ["ls-remote", "--tags", remote]);
    const tags = new Set<string>();
    for (const line of out.split("\n")) {
      const m = line.trim().match(/refs\/tags\/(.+?)(\^\{\})?$/);
      if (m) {
        tags.add(m[1]);
      }
    }
    remoteTagCache.set(cacheKey, { tags, expiresAt: now + REMOTE_CACHE_MS });

    return tags;
  } catch {
    return null;
  }
}

function parseEmail(raw: string): string {
  return raw.replace(/^</, "").replace(/>$/, "").trim();
}

export async function gitListTags(id: string): Promise<GitTag[]> {
  const ws = requireSession(id);
  const out = await git(ws.path, [
    "for-each-ref",
    `--format=${TAG_FORMAT}${RECORD_SEP}`,
    "refs/tags",
  ]);
  const remotes = await git(ws.path, ["remote"]).catch(() => "");
  const firstRemote = remotes.split("\n")[0]?.trim() ?? "";
  const remoteTags =
    firstRemote.length > 0 ? await loadRemoteTags(ws.path, firstRemote) : null;

  return out
    .split(RECORD_SEP)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [
        name = "",
        objType = "",
        objName = "",
        peeledHash = "",
        subject = "",
        taggerName = "",
        taggerEmail = "",
        taggerDate = "",
        message = "",
        creatorDate = "",
      ] = line.split(FIELD_SEP);
      const isAnnotated = objType === "tag";
      const commitHash = isAnnotated ? peeledHash || objName : objName;
      const pushed = remoteTags === null ? null : remoteTags.has(name);
      const tag: GitTag = {
        name,
        commitHash,
        subject,
        isAnnotated,
        creatorDate,
        pushed,
      };
      if (isAnnotated && taggerName) {
        tag.tagger = {
          name: taggerName,
          email: parseEmail(taggerEmail),
          date: taggerDate,
        };
      }
      if (message.trim().length > 0) {
        tag.message = message;
      }

      return tag;
    });
}

export interface CreateTagOpts {
  name: string;
  ref?: string;
  message?: string;
  sign?: boolean;
  /** When true, overwrite an existing tag of the same name (`git tag -f`). */
  force?: boolean;
}

export async function gitCreateTag(
  id: string,
  opts: CreateTagOpts,
): Promise<void> {
  const { path } = requireProjectScope(id);
  if (!opts.name.trim()) {
    throw new GitError("unknown", "Tag name cannot be empty");
  }
  await withGitLock(path, async () => {
    const args = ["tag"];
    if (opts.sign) {
      args.push("-s");
    }
    if (opts.force) {
      args.push("-f");
    }
    if (opts.message && opts.message.length > 0) {
      args.push("-a", opts.name, "-m", opts.message);
    } else {
      args.push(opts.name);
    }
    if (opts.ref) {
      args.push(opts.ref);
    }
    await git(path, args);
    remoteTagCache.delete(`${path}|origin`);
  });
}

export async function gitDeleteTag(
  id: string,
  opts: { name: string },
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    await git(path, ["tag", "-d", opts.name]);
    remoteTagCache.delete(`${path}|origin`);
  });
}

export interface PushTagOpts {
  name?: string;
  all?: boolean;
  remote?: string;
}

export async function gitPushTag(id: string, opts: PushTagOpts): Promise<void> {
  const { path } = requireProjectScope(id);
  const remote = opts.remote ?? "origin";
  await withGitLock(path, async () => {
    if (opts.all) {
      await git(path, ["push", remote, "--tags"]);
    } else if (opts.name) {
      await git(path, ["push", remote, `refs/tags/${opts.name}`]);
    } else {
      throw new GitError("unknown", "Either `name` or `all` is required");
    }
    remoteTagCache.delete(`${path}|${remote}`);
  });
}
