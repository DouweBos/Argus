/**
 * Which app a changeset is for, from a `# platforms: mac, ios` comment in its
 * frontmatter. A comment because changesets reads every frontmatter key as a
 * package name.
 */

export const PLATFORMS = ["mac", "ios"] as const;
export type Platform = (typeof PLATFORMS)[number];

const COMMENT = /^#\s*platforms:\s*(.*)$/m;

/** The platforms a changeset's raw text names, or null when it names none or an unknown one. */
export function changesetPlatforms(raw: string): Platform[] | null {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? "";
  const listed = COMMENT.exec(frontmatter)?.[1];
  if (listed === undefined) {
    return null;
  }
  const names = listed
    .replace(/[[\]]/g, "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (
    names.length === 0 ||
    !names.every((name) => (PLATFORMS as readonly string[]).includes(name))
  ) {
    return null;
  }

  return names as Platform[];
}

/** The marker the changelog generator leaves on an entry; release-notes.ts reads and strips it. */
export function platformMarker(platforms: Platform[]): string {
  return `<!-- platforms: ${platforms.join(", ")} -->`;
}

export const MARKER = /\s*<!-- platforms: ([a-z, ]+) -->/;
