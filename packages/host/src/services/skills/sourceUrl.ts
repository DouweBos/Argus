/** What a skill's install URL names: a gist, or a git repository and a folder in it. */

import type { CloneSourceSpec } from "../clone/url";
import { parseCloneSource } from "../clone/url";

export type SkillUrl =
  | {
      kind: "git";
      source: CloneSourceSpec;
      ref: string | null;
      subpath: string | null;
    }
  | { kind: "gist"; id: string; cloneUrl: string };

const GIST_ID = /^[0-9a-f]{7,40}$/i;
const GIST_HOSTS = new Set(["gist.github.com", "gist.githubusercontent.com"]);

/**
 * `gist.github.com/<user>/<id>`, `gist.github.com/<id>(.git)` and the raw
 * links under them; null for anything else.
 */
export function parseGistUrl(raw: string): string | null {
  const input = raw.trim();
  const scp = /^git@gist\.github\.com:([0-9a-f]+)(?:\.git)?$/i.exec(input);
  if (scp) {
    return GIST_ID.test(scp[1]) ? scp[1].toLowerCase() : null;
  }
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (!GIST_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }
  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((p) => p.replace(/\.git$/i, ""));
  // `/<id>` or `/<user>/<id>[/raw/…]`.
  const id =
    GIST_ID.test(parts[0] ?? "") && parts.length === 1 ? parts[0] : parts[1];

  return id && GIST_ID.test(id) ? id.toLowerCase() : null;
}

/** A relative folder inside the source, or null for its root. Throws on `..` or an absolute path. */
export function normalizeSubpath(
  raw: string | null | undefined,
): string | null {
  const trimmed = (raw ?? "").trim().replace(/\\/g, "/");
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) {
    throw "The path inside the repository must be relative, like skills/review.";
  }
  const parts = trimmed.split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) {
    throw "The path inside the repository can't climb out of it.";
  }

  return parts.length ? parts.join("/") : null;
}

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

/**
 * A gist, or a git address (anything Clone Repository takes) with GitHub's
 * `/tree/<ref>/<path>` and `/blob/<ref>/<path>/SKILL.md` links split into the
 * repository, ref and folder. `subpath`, when given, wins over the link's.
 */
export function parseSkillUrl(raw: string, subpath?: string | null): SkillUrl {
  const gist = parseGistUrl(raw);
  if (gist) {
    return {
      kind: "gist",
      id: gist,
      cloneUrl: `https://gist.github.com/${gist}.git`,
    };
  }
  let input = raw.trim();
  let ref: string | null = null;
  let linked: string | null = null;
  const tree =
    /^(https?:\/\/(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+?)(?:\.git)?\/(tree|blob)\/([^/\s]+)(?:\/([^\s?#]*))?(?:[?#].*)?$/i.exec(
      input,
    );
  if (tree) {
    input = tree[1];
    ref = decodeURIComponent(tree[3]);
    let inner = decodeURIComponent(tree[4] ?? "");
    if (tree[2].toLowerCase() === "blob") {
      inner = inner.split("/").slice(0, -1).join("/");
    }
    linked = inner;
    if (!SAFE_REF.test(ref) || ref.includes("..")) {
      throw "That link's branch name isn't one Argus can clone.";
    }
  }
  const source = parseCloneSource(input);

  return {
    kind: "git",
    source,
    ref,
    subpath: normalizeSubpath(subpath?.trim() ? subpath : linked),
  };
}
