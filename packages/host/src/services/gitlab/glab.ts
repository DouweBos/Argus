/**
 * GitLab through the `glab` CLI's `api` command, the way the GitHub service
 * goes through `gh`: no token of Argus's own, and self-hosted instances work
 * once `glab auth login --hostname` has been run for them.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 50 * 1024 * 1024;

/** `glab` is missing or signed out: nothing GitLab can be known right now. */
export class GlabUnavailable extends Error {}

export function glabErrorMessage(e: unknown): string {
  const err = e as { code?: unknown; message?: string; stderr?: string };
  if (err.code === "ENOENT") {
    return "The GitLab CLI (glab) is not installed. Install it from https://gitlab.com/gitlab-org/cli and run `glab auth login`.";
  }
  const text = `${err.stderr ?? ""} ${err.message ?? ""}`;
  if (/401|unauthori[sz]ed|not logged in|no token/i.test(text)) {
    return "Not signed in to GitLab. Run `glab auth login` to sign in.";
  }

  return err.stderr?.trim() || err.message || String(e);
}

/** `projects/<id>` with the path URL-encoded, as GitLab's REST API wants it. */
export function projectApiPath(projectPath: string): string {
  return `projects/${encodeURIComponent(projectPath)}`;
}

async function glab(
  host: string,
  args: string[],
): Promise<{ stdout: string; failed: unknown }> {
  try {
    const { stdout } = await execFileAsync(
      "glab",
      ["api", "--hostname", host, ...args],
      { maxBuffer: MAX_BUFFER },
    );

    return { stdout, failed: null };
  } catch (e) {
    const err = e as { code?: unknown; stdout?: string };
    if (err.code === "ENOENT") {
      throw new GlabUnavailable(glabErrorMessage(e));
    }

    return { stdout: err.stdout ?? "", failed: e };
  }
}

type Fields = Record<string, boolean | number | string>;

function fieldArgs(fields: Fields | undefined): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(fields ?? {})) {
    // `-F` types numbers and booleans; `-f` keeps strings verbatim.
    args.push(typeof value === "string" ? "-f" : "-F", `${key}=${value}`);
  }

  return args;
}

/** A REST call; throws the API's message as a string on failure. */
export async function glabRest<T>(
  host: string,
  apiPath: string,
  options: { fields?: Fields; method?: "GET" | "POST" | "PUT" } = {},
): Promise<T> {
  const { stdout, failed } = await glab(host, [
    "--method",
    options.method ?? "GET",
    apiPath,
    ...fieldArgs(options.fields),
  ]);
  if (failed) {
    throw glabErrorMessage(failed);
  }

  return JSON.parse(stdout) as T;
}

/** A REST call whose body is plain text, e.g. a job log. */
export async function glabText(host: string, apiPath: string): Promise<string> {
  const { stdout, failed } = await glab(host, ["--method", "GET", apiPath]);
  if (failed) {
    throw glabErrorMessage(failed);
  }

  return stdout;
}

/** Every page of a list endpoint, `per_page=100` at a time. */
export async function glabRestAll<T>(
  host: string,
  apiPath: string,
  maxPages = 10,
): Promise<T[]> {
  const out: T[] = [];
  const sep = apiPath.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPages; page += 1) {
    const rows = await glabRest<T[]>(
      host,
      `${apiPath}${sep}per_page=100&page=${page}`,
    );
    out.push(...rows);
    if (rows.length < 100) {
      break;
    }
  }

  return out;
}

/**
 * A GraphQL query. Partial errors still return their data; a reply with no
 * data at all means `glab` can't reach GitLab and throws `GlabUnavailable`.
 */
export async function glabGraphql<T>(
  host: string,
  query: string,
  variables: Record<string, number | string> = {},
): Promise<T> {
  const { stdout, failed } = await glab(host, [
    "graphql",
    "-f",
    `query=${query}`,
    ...fieldArgs(variables),
  ]);
  let parsed: { data?: T | null; errors?: { message?: string }[] };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    throw new GlabUnavailable(
      failed ? glabErrorMessage(failed) : stdout.slice(0, 200),
    );
  }
  if (!parsed.data) {
    throw new GlabUnavailable(
      parsed.errors?.map((e) => e.message).join("; ") ||
        (failed ? glabErrorMessage(failed) : "GitLab returned no data"),
    );
  }

  return parsed.data;
}

/** A GraphQL string literal; JSON's escaping is a subset GraphQL accepts. */
export function gqlString(value: string): string {
  return JSON.stringify(value);
}

/** GitLab returns avatars relative to the instance for uploaded ones. */
export function absoluteUrl(
  host: string,
  url: string | null | undefined,
): string | null {
  if (!url) {
    return null;
  }

  return url.startsWith("/") ? `https://${host}${url}` : url;
}
