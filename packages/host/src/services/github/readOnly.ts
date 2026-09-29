/**
 * GitHub reads for automation runs that may not use the shell for them.
 *
 * The method is fixed here rather than read from an argv, so a read-only run
 * can fetch CI logs and artifacts without Argus parsing `gh api` flags.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Cap on what one call hands back to the agent. */
export const MAX_OUTPUT_CHARS = 60_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const REPO_SLUG = /^[\w.-]+\/[\w.-]+$/;

/** A REST path `gh api` will GET, e.g. `repos/o/r/actions/runs/1/jobs`. */
export function validateApiPath(apiPath: string): string {
  const trimmed = apiPath.trim().replace(/^\/+/, "");
  if (!trimmed || /\s/.test(trimmed) || trimmed.startsWith("-")) {
    throw "The path must be a REST API path such as repos/owner/name/actions/runs.";
  }
  if (/^graphql(\/|\?|$)/.test(trimmed)) {
    throw "GraphQL is sent as a POST, so it is not available here.";
  }

  return trimmed;
}

export function validateRepo(repo: string): string {
  if (!REPO_SLUG.test(repo)) {
    throw `Not an owner/name repository: ${repo}`;
  }

  return repo;
}

/** Lines matching `pattern`, or the text itself when there is no pattern. */
export function filterLines(
  text: string,
  pattern: string | undefined,
  maxLines: number,
): string {
  if (!pattern) {
    return text;
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    throw `Invalid pattern: ${pattern}`;
  }
  const hits = text.split("\n").filter((line) => regex.test(line));
  const shown = hits.slice(0, maxLines);
  const more = hits.length - shown.length;

  return more > 0
    ? `${shown.join("\n")}\n… ${more} more matching lines`
    : shown.join("\n");
}

export function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… truncated at ${MAX_OUTPUT_CHARS} characters; narrow it with jq or pattern`
    : text;
}

function ghError(e: unknown): string {
  const stderr = (e as { stderr?: string }).stderr?.trim();

  return stderr || String(e);
}

export async function githubGet(options: {
  path: string;
  jq?: string;
  paginate?: boolean;
  pattern?: string;
  maxLines: number;
}): Promise<string> {
  const args = ["api", "--method", "GET", validateApiPath(options.path)];
  if (options.paginate) {
    args.push("--paginate");
  }
  if (options.jq) {
    args.push("--jq", options.jq);
  }
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("gh", args, { maxBuffer: MAX_BUFFER }));
  } catch (e) {
    throw ghError(e);
  }

  return truncate(filterLines(stdout, options.pattern, options.maxLines));
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * Download one run artifact into a scratch dir Argus owns, grep it, delete it.
 * The run never gets a path to write to.
 */
export async function searchGithubArtifact(options: {
  repo: string;
  runId: string;
  artifact: string;
  pattern: string;
  maxLines: number;
}): Promise<string> {
  const repo = validateRepo(options.repo);
  if (!/^\d+$/.test(options.runId)) {
    throw `Not a run id: ${options.runId}`;
  }
  if (!options.artifact || options.artifact.startsWith("-")) {
    throw `Not an artifact name: ${options.artifact}`;
  }
  let regex: RegExp;
  try {
    regex = new RegExp(options.pattern, "i");
  } catch {
    throw `Invalid pattern: ${options.pattern}`;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-artifact-"));
  try {
    try {
      await execFileAsync(
        "gh",
        [
          "run",
          "download",
          options.runId,
          "-R",
          repo,
          "-n",
          options.artifact,
          "-D",
          dir,
        ],
        { maxBuffer: MAX_BUFFER },
      );
    } catch (e) {
      throw ghError(e);
    }

    const hits: string[] = [];
    let total = 0;
    for (const file of walkFiles(dir)) {
      const content = fs.readFileSync(file);
      // Screenshots and recordings ride along in test artifacts.
      if (content.subarray(0, 8000).includes(0)) {
        continue;
      }
      const relative = path.relative(dir, file);
      const lines = content.toString("utf8").split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        if (regex.test(lines[i]!)) {
          total += 1;
          if (hits.length < options.maxLines) {
            hits.push(`${relative}:${i + 1}: ${lines[i]}`);
          }
        }
      }
    }
    if (total === 0) {
      return `No lines match ${options.pattern} in ${options.artifact}.`;
    }
    const more = total - hits.length;

    return truncate(
      more > 0
        ? `${hits.join("\n")}\n… ${more} more matching lines`
        : hits.join("\n"),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
