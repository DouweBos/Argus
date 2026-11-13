/**
 * The code-host repos behind each project's git remotes, and the reverse:
 * which known repo a wire slug like `group/sub/project` names.
 */

import type { RepoRef } from "./remoteUrl";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { appState } from "../../state";
import { repoRefFromUrl } from "./remoteUrl";

const execFileAsync = promisify(execFile);

const CACHE_MS = 60_000;

function glabConfigFiles(): string[] {
  const env = process.env;
  const dirs = [
    env.GLAB_CONFIG_DIR,
    env.XDG_CONFIG_HOME && path.join(env.XDG_CONFIG_HOME, "glab-cli"),
    path.join(os.homedir(), ".config", "glab-cli"),
    path.join(os.homedir(), "Library", "Application Support", "glab-cli"),
  ].filter((d): d is string => !!d);

  return [...new Set(dirs)].map((d) => path.join(d, "config.yml"));
}

/** The keys under `hosts:` in glab's config; values (tokens) are never kept. */
export function parseGlabHosts(yaml: string): string[] {
  const hosts: string[] = [];
  let indent: number | null = null;
  let inHosts = false;
  for (const line of yaml.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }
    const lead = line.length - line.trimStart().length;
    if (lead === 0) {
      inHosts = /^hosts:\s*$/.test(line);
      indent = null;
      continue;
    }
    if (!inHosts) {
      continue;
    }
    indent ??= lead;
    const key =
      lead === indent ? /^\s*["']?([^"':\s]+)["']?:/.exec(line) : null;
    if (key) {
      hosts.push(key[1]!.toLowerCase());
    }
  }

  return hosts;
}

let hostsCache: { at: number; hosts: Set<string> } | null = null;

/** GitLab instances `glab` is configured for, plus `GITLAB_HOST`. */
export function knownGitlabHosts(): Set<string> {
  if (hostsCache && Date.now() - hostsCache.at < CACHE_MS) {
    return hostsCache.hosts;
  }
  const hosts = new Set<string>(["gitlab.com"]);
  const fromEnv = process.env.GITLAB_HOST?.replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  if (fromEnv) {
    hosts.add(fromEnv);
  }
  for (const file of glabConfigFiles()) {
    try {
      for (const host of parseGlabHosts(fs.readFileSync(file, "utf8"))) {
        hosts.add(host);
      }
    } catch {
      // Not configured there.
    }
  }
  hostsCache = { at: Date.now(), hosts };

  return hosts;
}

interface RemoteRef {
  ref: RepoRef;
  remote: string;
}

const refsCache = new Map<string, { at: number; refs: RemoteRef[] }>();

/** Every remote of a repo that lives on a code host Argus can talk to. */
export async function remoteRepoRefs(repoRoot: string): Promise<RemoteRef[]> {
  const hit = refsCache.get(repoRoot);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return hit.refs;
  }
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("git", ["-C", repoRoot, "remote", "-v"], {
      maxBuffer: 1024 * 1024,
    }));
  } catch {
    return [];
  }
  const gitlabHosts = knownGitlabHosts();
  const seen = new Set<string>();
  const refs: RemoteRef[] = [];
  for (const line of stdout.split("\n")) {
    const [remote, url] = line.trim().split(/\s+/);
    const ref = remote && url ? repoRefFromUrl(url, gitlabHosts) : null;
    const key = ref
      ? `${ref.kind}\0${ref.host}\0${ref.path.toLowerCase()}`
      : "";
    if (ref && !seen.has(key)) {
      seen.add(key);
      refs.push({ remote: remote!, ref });
    }
  }
  refsCache.set(repoRoot, { at: Date.now(), refs });

  return refs;
}

export async function repoRefs(repoRoot: string): Promise<RepoRef[]> {
  return (await remoteRepoRefs(repoRoot)).map((r) => r.ref);
}

export async function gitlabRepoRefs(repoRoot: string): Promise<RepoRef[]> {
  return (await repoRefs(repoRoot)).filter((r) => r.kind === "gitlab");
}

/**
 * The repo a new pull request for `branch` goes to: the branch's upstream
 * remote, then `origin`, then the first one on a code host.
 */
export async function preferredRepoRef(
  repoRoot: string,
  branch?: string | null,
): Promise<RepoRef | null> {
  const refs = await remoteRepoRefs(repoRoot);
  let upstream: string | null = null;
  if (branch) {
    try {
      upstream =
        (
          await execFileAsync("git", [
            "-C",
            repoRoot,
            "config",
            `branch.${branch}.remote`,
          ])
        ).stdout.trim() || null;
    } catch {
      // No upstream configured.
    }
  }
  for (const name of [upstream, "origin"]) {
    const hit = refs.find((r) => r.remote === name);
    if (hit) {
      return hit.ref;
    }
  }

  return refs[0]?.ref ?? null;
}

/** Every repo root Argus has open, whether or not a session is on it. */
function openRepoRoots(): string[] {
  return [
    ...new Set([
      ...appState.repoRoots,
      ...[...appState.sessions.values()].map((s) => s.repo_root),
    ]),
  ];
}

/**
 * The repo a client means by `owner/repo` (a GitLab path may have more
 * segments). GitHub unless an open project has it as a GitLab remote — the
 * wire predates GitLab, so an unknown slug keeps meaning what it always did.
 */
export async function resolveRepoSlug(slug: string): Promise<RepoRef> {
  const want = slug.toLowerCase();
  for (const root of openRepoRoots()) {
    for (const ref of await repoRefs(root)) {
      if (ref.path.toLowerCase() === want) {
        return ref;
      }
    }
  }

  return { kind: "github", host: "github.com", path: slug };
}

/** Test-only. */
export function resetRepoRefCaches(): void {
  refsCache.clear();
  hostsCache = null;
}
