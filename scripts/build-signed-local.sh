#!/usr/bin/env bash
#
# Build a signed + notarized macOS release locally without publishing it.
#
# Usage:
#   set -a; source ~/.argus-release.env; set +a
#   ./scripts/build-signed-local.sh
#
# Output: release/Argus-<version>-arm64.dmg (and .zip) — fully Gatekeeper-clean,
# safe to hand to anyone with an Apple Silicon Mac. Skips the GitHub upload and
# the version-bump dance, so you can iterate without polluting the repo.

set -euo pipefail

cd "$(dirname "$0")/.."

required=(
  MATCH_GIT_URL
  MATCH_PASSWORD
  APP_STORE_CONNECT_API_KEY_ID
  APP_STORE_CONNECT_API_KEY_ISSUER_ID
  APP_STORE_CONNECT_API_KEY_CONTENT
)
missing=()
for var in "${required[@]}"; do
  [[ -z "${!var:-}" ]] && missing+=("$var")
done
if (( ${#missing[@]} > 0 )); then
  echo "error: missing env vars — load ~/.argus-release.env first" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

exec bundle exec fastlane mac release \
  publish:false \
  allow_dirty:true \
  allow_any_branch:true
