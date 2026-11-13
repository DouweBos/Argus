/**
 * Helpers for the "Push & open PR" flow: compare / new-MR URL construction
 * and pull-request template discovery.
 *
 * Kept in its own module (no Electron imports) so the helpers can be tested
 * without pulling in `main.ts` and its protocol/BrowserWindow wiring.
 */

import fs from "node:fs";
import path from "node:path";
import { newPullRequestUrl, repoRefFromUrl } from "../codeHost/remoteUrl";
import { knownGitlabHosts } from "../codeHost/repos";

/**
 * Locations GitHub scans for a single pull-request template file. A file at
 * any of these paths (case-insensitive) is auto-populated into the PR form
 * when `?expand=1` is passed — so we don't need to emit `?template=`.
 */
const PR_TEMPLATE_FILE_LOCATIONS: string[] = [
  "PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/pull_request_template.md",
  // GitLab applies `Default` to new merge requests on its own.
  ".gitlab/merge_request_templates/Default.md",
];

/**
 * Locations GitHub scans for *directories* of pull-request templates. A
 * directory with multiple `.md` files requires the caller to pass
 * `?template=<filename>` in the compare URL — otherwise the PR body opens
 * empty and GitHub shows no picker on the compare page.
 */
const PR_TEMPLATE_DIR_LOCATIONS: string[] = [
  "PULL_REQUEST_TEMPLATE",
  "pull_request_template",
  "docs/PULL_REQUEST_TEMPLATE",
  "docs/pull_request_template",
  ".github/PULL_REQUEST_TEMPLATE",
  ".github/pull_request_template",
];

/**
 * Resolve the textual content of the pull-request template for `repoRoot`,
 * if any, from the standard GitHub locations (single-file templates and the
 * first template in a directory, alphabetically).
 *
 * Returns `null` when no template is found — callers should treat that as
 * "no prefill".
 */
export function readPullRequestTemplate(repoRoot: string): string | null {
  for (const file of PR_TEMPLATE_FILE_LOCATIONS) {
    const full = path.join(repoRoot, file);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return fs.readFileSync(full, "utf8");
    }
  }

  for (const dir of PR_TEMPLATE_DIR_LOCATIONS) {
    const full = path.join(repoRoot, dir);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
      continue;
    }
    const files = fs
      .readdirSync(full)
      .filter((name) => name.toLowerCase().endsWith(".md"))
      .sort();
    if (files.length > 0) {
      return fs.readFileSync(path.join(full, files[0]), "utf8");
    }
  }

  return null;
}

/**
 * Find the filename of the pull-request template to apply when opening a
 * compare URL. Returns `null` when the repo either has no template or has
 * exactly one single-file template (GitHub auto-applies single templates —
 * no `template=` query param is needed, and passing one would be wrong when
 * the file name differs in case).
 *
 * When the repo has a multi-template directory, returns the first filename
 * alphabetically so the compare URL always links to a concrete template.
 */
export function pickPullRequestTemplate(repoRoot: string): string | null {
  for (const dir of PR_TEMPLATE_DIR_LOCATIONS) {
    const full = `${repoRoot}/${dir}`;
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
      continue;
    }
    const files = fs
      .readdirSync(full)
      .filter((name) => name.toLowerCase().endsWith(".md"))
      .sort();
    if (files.length > 0) {
      return files[0];
    }
  }

  // Single-file templates at the canonical locations are auto-applied by
  // GitHub — skip the `template=` query param so we don't pin a case that
  // happens to differ.
  for (const file of PR_TEMPLATE_FILE_LOCATIONS) {
    if (fs.existsSync(`${repoRoot}/${file}`)) {
      return null;
    }
  }

  return null;
}

/**
 * Convert a git remote URL into an "open PR" URL — GitHub's compare page or
 * GitLab's new-merge-request form. Returns `null` for other hosts so callers
 * can fall back (e.g. show the branch name so the user can file it manually).
 *
 * When `template` is provided, GitHub gets a `template=<name>` query parameter
 * so repos with multiple templates in `.github/PULL_REQUEST_TEMPLATE/` open
 * the correct one (otherwise the PR body is empty).
 */
export function buildPullRequestUrl(
  remoteUrl: string,
  branch: string,
  baseBranch: string | null,
  template?: string | null,
): string | null {
  const ref = repoRefFromUrl(remoteUrl, knownGitlabHosts());

  return ref ? newPullRequestUrl(ref, branch, baseBranch, template) : null;
}
