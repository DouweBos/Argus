// Tiny MAJOR.MINOR.PATCH comparator. Pre-release / build suffixes are
// stripped before comparison; the project-settings parser already rejects
// them, so this is purely defensive for older configs / app versions.

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)/;

function parts(version: string): [number, number, number] | null {
  const match = version.trim().match(SEMVER_RE);
  if (!match) {
    return null;
  }

  return [
    parseInt(match[1], 10),
    parseInt(match[2], 10),
    parseInt(match[3], 10),
  ];
}

/**
 * Returns true when `version` is strictly older than `min`. If either string
 * is unparseable, returns false (we don't want to scare users with a warning
 * we can't justify).
 */
export function isOlderThan(version: string, min: string): boolean {
  const a = parts(version);
  const b = parts(min);
  if (!a || !b) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) {
      return true;
    }
    if (a[i] > b[i]) {
      return false;
    }
  }

  return false;
}
