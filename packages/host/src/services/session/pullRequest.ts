/**
 * Helpers for the "Push & open PR" flow: GitHub compare-URL construction
 * and pull-request template discovery.
 *
 * Kept in its own module (no Electron imports) so the helpers can be tested
 * without pulling in `main.ts` and its protocol/BrowserWindow wiring.
 */

import fs from "node:fs";
import path from "node:path";

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
 * if any. Honors the same `.argus.json` `pull_request_template` override as
 * {@link pickPullRequestTemplate} and falls back to the standard GitHub
 * locations (single-file templates and the first template in a directory,
 * alphabetically).
 *
 * Returns `null` when no template is found or the override points at a file
 * that doesn't exist on disk — callers should treat that as "no prefill".
 */
export function readPullRequestTemplate(repoRoot: string): string | null {
  let override: string | null = null;
  try {
    const raw = fs.readFileSync(path.join(repoRoot, ".argus.json"), "utf8");
    const cfg = JSON.parse(raw) as { pull_request_template?: unknown };
    if (
      typeof cfg.pull_request_template === "string" &&
      cfg.pull_request_template.trim().length > 0
    ) {
      override = cfg.pull_request_template.trim();
    }
  } catch {
    // ignore
  }

  if (override) {
    for (const dir of PR_TEMPLATE_DIR_LOCATIONS) {
      const full = path.join(repoRoot, dir, override);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        return fs.readFileSync(full, "utf8");
      }
    }
    const direct = path.join(repoRoot, override);
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
      return fs.readFileSync(direct, "utf8");
    }

    return null;
  }

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
 * The default can be overridden via `.argus.json`'s `pull_request_template`
 * field.
 */
export function pickPullRequestTemplate(repoRoot: string): string | null {
  // Allow projects to pin a specific template name via `.argus.json`. Useful
  // when a repo has many templates and a particular one is right for
  // Argus-authored PRs. Read the file directly to avoid pulling in the
  // heavier `setup.ts` (and its Electron dependencies) from this module.
  try {
    const raw = fs.readFileSync(path.join(repoRoot, ".argus.json"), "utf8");
    const cfg = JSON.parse(raw) as { pull_request_template?: unknown };
    const override = cfg.pull_request_template;
    if (typeof override === "string" && override.trim().length > 0) {
      return override.trim();
    }
  } catch {
    // No config or parse error — fall through to filesystem discovery.
  }

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
 * Convert a git remote URL into a GitHub "open PR" URL. Returns `null` for
 * non-GitHub hosts so callers can decide how to handle (e.g. just open the
 * remote URL, or show the branch name so the user can file the PR manually).
 *
 * When `template` is provided, appends a `template=<name>` query parameter
 * so repos with multiple templates in `.github/PULL_REQUEST_TEMPLATE/` open
 * the correct one (GitHub requires this — otherwise the PR body is empty).
 */
export function buildPullRequestUrl(
  remoteUrl: string,
  branch: string,
  baseBranch: string | null,
  template?: string | null,
): string | null {
  // ssh: git@github.com:owner/repo(.git)   |  https://github.com/owner/repo(.git)
  const match =
    remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i) ?? null;
  if (!match) {
    return null;
  }
  const [, owner, repo] = match;
  const encBranch = encodeURIComponent(branch);
  const templateParam =
    template && template.trim().length > 0
      ? `&template=${encodeURIComponent(template.trim())}`
      : "";
  if (baseBranch) {
    const encBase = encodeURIComponent(baseBranch);

    return `https://github.com/${owner}/${repo}/compare/${encBase}...${encBranch}?expand=1${templateParam}`;
  }

  return `https://github.com/${owner}/${repo}/pull/new/${encBranch}${
    templateParam ? `?expand=1${templateParam}` : ""
  }`;
}
