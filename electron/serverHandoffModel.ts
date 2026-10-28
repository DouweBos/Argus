/**
 * Pure half of the Electron server's hand-off to the native `Argus Server.app`:
 * the appcast parser, version ordering, and the checks that decide whether a
 * downloaded bundle is the native server. No Electron, no I/O, so it is tested
 * directly.
 */

export const NATIVE_BUNDLE_ID = "dev.houwert.argus.server";
export const NATIVE_TEAM_ID = "CKZT75PN5T";

export type HandoffChannel = "alpha" | "beta" | "latest";

export interface AppcastItem {
  /** `sparkle:version` — the build number Sparkle orders by. */
  version: string;
  /** `sparkle:shortVersionString` — what people read. */
  shortVersion: string;
  url: string;
  length: number | null;
  minimumSystemVersion: string | null;
}

export function nativeAppcastUrl(channel: HandoffChannel): string {
  return `https://houwert.dev/argus/updates/argus-server-${channel}.xml`;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function elementText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(xml);

  return match ? decodeEntities(match[1]) : null;
}

function attributes(tagBody: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tagBody.matchAll(/([\w:]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs.set(m[1], decodeEntities(m[3] ?? m[4] ?? ""));
  }

  return attrs;
}

/** One `<item>`, or null when it lacks what an install needs. */
function parseItem(xml: string): AppcastItem | null {
  const enclosureTag = /<enclosure\b([^>]*?)\/?>/.exec(xml);
  if (!enclosureTag) {
    return null;
  }
  const enclosure = attributes(enclosureTag[1]);
  const url = enclosure.get("url");
  // Sparkle 1 put the versions on the enclosure; Sparkle 2 uses elements.
  const version =
    elementText(xml, "sparkle:version") ?? enclosure.get("sparkle:version");
  const shortVersion =
    elementText(xml, "sparkle:shortVersionString") ??
    enclosure.get("sparkle:shortVersionString") ??
    version;
  if (!url || !version || !shortVersion || !url.startsWith("https://")) {
    return null;
  }
  const length = Number(enclosure.get("length"));

  return {
    version,
    shortVersion,
    url,
    length: Number.isFinite(length) && length > 0 ? length : null,
    minimumSystemVersion: elementText(xml, "sparkle:minimumSystemVersion"),
  };
}

/** The newest installable item in a Sparkle appcast, by build number. */
export function parseNewestAppcastItem(xml: string): AppcastItem | null {
  let newest: AppcastItem | null = null;
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const item = parseItem(m[1]);
    if (
      item &&
      (!newest || compareVersions(item.version, newest.version) > 0)
    ) {
      newest = item;
    }
  }

  return newest;
}

function compareParts(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? "0";
    const y = b[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    const diff =
      Number.isNaN(nx) || Number.isNaN(ny) ? x.localeCompare(y) : nx - ny;
    if (diff !== 0) {
      return Math.sign(diff);
    }
  }

  return 0;
}

/** Semver-ish ordering: numeric dotted core, a `-prerelease` sorts below its release. */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = a.trim().replace(/^v/, "").split(/-(.*)/s);
  const [coreB, preB] = b.trim().replace(/^v/, "").split(/-(.*)/s);
  const core = compareParts(coreA.split("."), coreB.split("."));
  if (core !== 0) {
    return core;
  }
  if (preA && !preB) {
    return -1;
  }
  if (!preA || !preB) {
    return preB ? 1 : 0;
  }

  return compareParts(preA.split("."), preB.split("."));
}

/**
 * Offer the native build at the same version too: it is a different product,
 * so equal numbers are still a move forward.
 */
export function shouldOfferNative(
  item: AppcastItem,
  runningVersion: string,
  osVersion: string,
): boolean {
  if (
    item.minimumSystemVersion &&
    compareVersions(osVersion, item.minimumSystemVersion) < 0
  ) {
    return false;
  }

  return compareVersions(item.shortVersion, runningVersion) >= 0;
}

/** `codesign -d -r-` output: our bundle id, pinned to our Developer ID team. */
export function designatedRequirementMatches(requirement: string): boolean {
  return (
    requirement.includes(`identifier "${NATIVE_BUNDLE_ID}"`) &&
    requirement.includes(NATIVE_TEAM_ID)
  );
}

/**
 * The Electron server is also an `LSUIElement` app with this bundle id, so
 * what tells the native one apart is the absence of Electron.
 */
export function nativeBundleProblem(
  infoPlist: Record<string, unknown>,
  hasElectronFramework: boolean,
): string | null {
  if (infoPlist.CFBundleIdentifier !== NATIVE_BUNDLE_ID) {
    return "the download is not Argus Server";
  }
  if (!infoPlist.LSUIElement) {
    return "the download is not a menu bar app";
  }
  if (hasElectronFramework || "ElectronAsarIntegrity" in infoPlist) {
    return "the download is the old Argus Server";
  }

  return null;
}

/** `/A/Argus Server.app/Contents/MacOS/Argus Server` → `/A/Argus Server.app`. */
export function appBundleFromExecPath(execPath: string): string | null {
  const parts = execPath.split("/");
  if (parts.length < 4 || parts.at(-3) !== "Contents") {
    return null;
  }
  const bundle = parts.slice(0, -3).join("/");

  return bundle.endsWith(".app") ? bundle : null;
}

/**
 * The swap, run by a detached `/bin/sh` after this process exits. Positional
 * args: pid, installed bundle, new bundle, backup path, temp dir. Any failure
 * puts the old bundle back and reopens it, so the machine never ends up
 * without a server.
 */
export const HANDOFF_SCRIPT = `
pid="$1"; old="$2"; new="$3"; backup="$4"; tmp="$5"
waited=0
while kill -0 "$pid" 2>/dev/null; do
  waited=$((waited + 1))
  if [ "$waited" -gt 120 ]; then echo "old server did not quit"; exit 1; fi
  sleep 1
done
rm -rf "$backup"
if ! mv "$old" "$backup"; then echo "could not move the old app"; open "$old"; exit 1; fi
if ! ditto "$new" "$old"; then
  echo "could not install the new app"
  rm -rf "$old"; mv "$backup" "$old"; open "$old"; exit 1
fi
rm -rf "$tmp"
echo "handed off"
open "$old"
`;
