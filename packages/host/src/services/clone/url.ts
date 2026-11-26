/** What a typed repository address names, and the command that clones it. */

import type { CloneUrlKind } from "@argus/remote-protocol";

export interface CloneSourceSpec {
  kind: CloneUrlKind;
  /** What git (or `gh repo clone`, for shorthand) is handed. */
  url: string;
  /** The repository's own name: the folder it lands in by default. */
  repoName: string;
}

const SHORTHAND =
  /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
const SCP_SSH = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:(?!\/\/)([^\s]+)$/;
const FOLDER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function nameFromPath(repoPath: string): string {
  const last = repoPath.replace(/\/+$/, "").split("/").pop() ?? "";

  return last.replace(/\.git$/i, "");
}

/**
 * `https://host/owner/repo(.git)`, `ssh://…`, `git@host:owner/repo(.git)` or
 * `owner/repo`. Throws a readable string for anything else, and for anything
 * git could read as an option.
 */
export function parseCloneSource(raw: string): CloneSourceSpec {
  const input = raw.trim();
  if (!input) {
    throw "Enter a repository URL or owner/repo.";
  }
  if (input.startsWith("-")) {
    throw "A repository address can't start with a dash.";
  }
  if (/\s/.test(input) || [...input].some((c) => c.charCodeAt(0) < 32)) {
    throw "A repository address can't contain spaces.";
  }

  const shorthand = SHORTHAND.exec(input);
  if (shorthand) {
    const repoName = shorthand[2].replace(/\.git$/i, "");
    if (!FOLDER_NAME.test(repoName)) {
      throw "That isn't a repository name.";
    }

    return { kind: "shorthand", url: `${shorthand[1]}/${repoName}`, repoName };
  }

  if (/^(https?|ssh):\/\//i.test(input)) {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw "That isn't a valid URL.";
    }
    const repoName = nameFromPath(parsed.pathname);
    if (
      !parsed.hostname ||
      !repoName ||
      parsed.pathname.split("/").length < 3
    ) {
      throw "The URL needs an owner and a repository, like https://github.com/owner/repo.";
    }

    return {
      kind: parsed.protocol === "ssh:" ? "ssh" : "https",
      url: input,
      repoName,
    };
  }

  const scp = SCP_SSH.exec(input);
  if (scp) {
    const repoName = nameFromPath(scp[1]);
    if (!repoName) {
      throw "The address needs a repository, like git@github.com:owner/repo.git.";
    }

    return { kind: "ssh", url: input, repoName };
  }

  throw "Use an https URL, an ssh address like git@github.com:owner/repo.git, or owner/repo.";
}

/** Why `name` can't be a folder, or null. */
export function folderNameProblem(name: string): string | null {
  if (!name) {
    return "Name the folder.";
  }
  if (!FOLDER_NAME.test(name) || name === "." || name === "..") {
    return "Use letters, digits, dots, dashes or underscores, not starting with a dot or dash.";
  }

  return null;
}

export interface CloneCommand {
  program: "gh" | "git";
  args: string[];
}

/**
 * Shorthand goes through `gh` when it is installed (private repos, the user's
 * own auth), otherwise over https. Every user-supplied value follows `--`.
 */
export function cloneCommand(
  source: CloneSourceSpec,
  dest: string,
  opts: { gh: boolean; depth?: number; branch?: string },
): CloneCommand {
  const depth = [
    ...(opts.depth ? ["--depth", String(opts.depth)] : []),
    ...(opts.branch ? ["--branch", opts.branch] : []),
  ];
  if (source.kind === "shorthand" && opts.gh) {
    return {
      program: "gh",
      args: ["repo", "clone", source.url, dest, "--", "--progress", ...depth],
    };
  }
  const url =
    source.kind === "shorthand"
      ? `https://github.com/${source.url}.git`
      : source.url;

  return {
    program: "git",
    args: ["clone", "--progress", ...depth, "--", url, dest],
  };
}
