/**
 * Submodule management (Phase 6B P9).
 *
 * Read-only listing accepts any session id; mutating ops (`init`, `update`,
 * `deinit`) gate to `kind === "project_root"` and wrap `withGitLock`.
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

export type SubmoduleStatus = "clean" | "modified" | "uninitialized";

export interface Submodule {
  name: string;
  path: string;
  url: string;
  commitHash: string;
  status: SubmoduleStatus;
}

interface SubmoduleConfig {
  name: string;
  path: string;
  url: string;
}

async function readSubmoduleConfig(cwd: string): Promise<SubmoduleConfig[]> {
  let raw: string;
  try {
    raw = await git(cwd, [
      "config",
      "--file",
      ".gitmodules",
      "--get-regexp",
      "^submodule\\..*",
    ]);
  } catch {
    return [];
  }
  const byName = new Map<string, Partial<SubmoduleConfig>>();
  for (const line of raw.split("\n")) {
    const m = line.match(/^submodule\.([^.]+)\.(\S+)\s+(.*)$/);
    if (!m) {
      continue;
    }
    const [, name, key, value] = m;
    const entry = byName.get(name) ?? { name };
    if (key === "path") {
      entry.path = value;
    } else if (key === "url") {
      entry.url = value;
    }
    byName.set(name, entry);
  }

  return Array.from(byName.values()).flatMap((c) =>
    c.path && c.url ? [{ name: c.name!, path: c.path, url: c.url }] : [],
  );
}

export async function gitSubmoduleList(id: string): Promise<Submodule[]> {
  const ws = requireSession(id);
  const configs = await readSubmoduleConfig(ws.path);
  if (configs.length === 0) {
    return [];
  }
  let statusOut = "";
  try {
    statusOut = await git(ws.path, ["submodule", "status"]);
  } catch {
    statusOut = "";
  }

  const statusByPath = new Map<
    string,
    { hash: string; status: SubmoduleStatus }
  >();
  for (const line of statusOut.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const prefix = line[0];
    // " <hash> <path> [(branch)]" — leading space=clean, +=modified, -=uninitialized
    const rest = line.slice(1);
    const match = rest.match(/^([0-9a-f]+)\s+(\S+)/);
    if (!match) {
      continue;
    }
    let status: SubmoduleStatus;
    if (prefix === "-") {
      status = "uninitialized";
    } else if (prefix === "+") {
      status = "modified";
    } else {
      status = "clean";
    }
    statusByPath.set(match[2], { hash: match[1], status });
  }

  return configs.map((c) => {
    const s = statusByPath.get(c.path);

    return {
      name: c.name,
      path: c.path,
      url: c.url,
      commitHash: s?.hash ?? "",
      status: s?.status ?? "uninitialized",
    };
  });
}

export async function gitSubmoduleInit(
  id: string,
  opts: { path?: string },
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    const args = ["submodule", "init"];
    if (opts.path) {
      args.push("--", opts.path);
    }
    await git(path, args);
  });
}

export async function gitSubmoduleUpdate(
  id: string,
  opts: { path?: string; remote?: boolean },
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    const args = ["submodule", "update", "--init", "--recursive"];
    if (opts.remote) {
      args.push("--remote");
    }
    if (opts.path) {
      args.push("--", opts.path);
    }
    await git(path, args);
  });
}

export async function gitSubmoduleDeinit(
  id: string,
  opts: { path: string; force?: boolean },
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    const args = ["submodule", "deinit"];
    if (opts.force) {
      args.push("-f");
    }
    args.push("--", opts.path);
    await git(path, args);
  });
}
