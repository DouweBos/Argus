#!/usr/bin/env bash
# Applies pending changesets for a release channel and writes this version's
# notes: all of them, the Mac's and the iPhone's. Every job of a release run
# calls it on the same commit, so each gets the same version without passing
# files around.
# Writes `version`, `has_changes` and `build` (for the leg named by $PLATFORM) to $GITHUB_OUTPUT.
set -euo pipefail

CHANNEL="${1:?usage: release-version.sh production|beta|alpha}"

if [ "$CHANNEL" = "production" ]; then
  pnpm changeset version
  if git diff --quiet; then
    echo "No changesets to release"
    echo "has_changes=false" >> "$GITHUB_OUTPUT"
    echo "build=false" >> "$GITHUB_OUTPUT"
    exit 0
  fi
else
  # Pre-release mode for this run only: the branch's changeset state stays
  # untouched, so the next production cut still sees every changeset.
  git checkout CHANGELOG.md || true
  pnpm changeset pre enter "$CHANNEL"
  pnpm changeset version
  pnpm changeset pre exit
  git checkout .changeset/pre.json 2>/dev/null || true
  rm -f .changeset/pre.json

  # changeset restarts the pre-release counter at 0 (the branch never carries
  # pre.json), so step past any existing v<base>-<channel>.N tag.
  git fetch --tags --quiet
  BUMPED=$(node -p "require('./package.json').version")
  BASE="${BUMPED%-*}"
  HIGHEST=$(git tag -l "v${BASE}-${CHANNEL}.*" \
    | sed -n "s/^v${BASE}-${CHANNEL}\.\([0-9][0-9]*\)$/\1/p" \
    | sort -n | tail -1)
  if [ -n "$HIGHEST" ]; then
    NEW_VERSION="${BASE}-${CHANNEL}.$((HIGHEST + 1))"
    echo "Bumping ${BUMPED} → ${NEW_VERSION} (highest existing tag: v${BASE}-${CHANNEL}.${HIGHEST})"
    node -e "const fs=require('fs');const p=require('./package.json');p.version='${NEW_VERSION}';fs.writeFileSync('./package.json',JSON.stringify(p,null,2)+'\n');"
  fi
fi

# release-notes.md, -mac.md and -ios.md, and CHANGELOG.md without the platform markers.
pnpm exec tsx scripts/changesets/release-notes.ts
# A release with only iPhone changes still ships the Mac app: give it the full notes.
[ -s release-notes-mac.md ] || cp release-notes.md release-notes-mac.md

VERSION=$(node -p "require('./package.json').version")
echo "Releasing v${VERSION} on ${CHANNEL}"
echo "version=${VERSION}" >> "$GITHUB_OUTPUT"
echo "has_changes=true" >> "$GITHUB_OUTPUT"
# Whether $PLATFORM (a build leg) has anything to ship: the iPhone sits out a release with no iPhone changes.
if [ "${PLATFORM:-}" = "ios" ] && [ ! -s release-notes-ios.md ]; then
  echo "No iPhone changes in v${VERSION}: skipping TestFlight"
  echo "build=false" >> "$GITHUB_OUTPUT"
else
  echo "build=true" >> "$GITHUB_OUTPUT"
fi
