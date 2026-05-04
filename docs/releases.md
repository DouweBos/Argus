# Releasing Argus

Cuts a signed + notarized macOS arm64 build, uploads it to a GitHub release.

## TL;DR

1. Add a changeset on every PR that should appear in release notes:

   ```
   pnpm changeset
   ```

   Pick a bump (patch/minor/major) for `argus`, write a one-line summary, commit
   the generated `.changeset/*.md` file alongside the change.

2. When ready to ship, go to **Actions → Release → Run workflow** on `main`.
   The workflow will:
   - Run `changeset version` to bump `package.json` + write `CHANGELOG.md`.
   - If nothing changed (no pending changesets), exit cleanly. Otherwise:
   - Commit `chore: release vX.Y.Z`, tag `vX.Y.Z`, push both back to `main`.
   - Build, sign with Developer ID, notarize via App Store Connect API, staple.
   - Publish a GitHub release with the `.dmg` + `.zip` and the CHANGELOG section
     as the release body.

3. Send the `.dmg` link to friends.

## Local release (escape hatch)

If CI is broken and you need to cut a build by hand:

```
export MATCH_PASSWORD=...
export APP_STORE_CONNECT_API_KEY_ID=...
export APP_STORE_CONNECT_API_KEY_ISSUER_ID=...
export APP_STORE_CONNECT_API_KEY_CONTENT="$(cat AuthKey_XXX.p8)"
export GITHUB_TOKEN=...    # only if you want it published

pnpm changeset version && git commit -am "chore: release" && git tag vX.Y.Z
pnpm dist:release
```

## Required GitHub Actions secrets

See `.github/workflows/release.yml`. These all live under **Settings → Secrets
and variables → Actions**:

| Secret                                | Used for                                                                                                                                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MATCH_GIT_URL`                       | HTTPS URL of the `apple-certificates` repo (e.g. `https://github.com/DouweBos/apple-certificates.git`)                                                                                                                                                            |
| `MATCH_GIT_BASIC_AUTHORIZATION`       | Base64 of `username:personal_access_token` for the cert repo (PAT needs `repo` read)                                                                                                                                                                              |
| `MATCH_PASSWORD`                      | The shared password the cert repo is encrypted with                                                                                                                                                                                                               |
| `MATCH_KEYCHAIN_PASSWORD`             | Any random string — used to unlock the throwaway CI keychain                                                                                                                                                                                                      |
| `APP_STORE_CONNECT_API_KEY_ID`        | Key ID of the App Store Connect API key (e.g. `ABCD1234`)                                                                                                                                                                                                         |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | Issuer UUID for the API key                                                                                                                                                                                                                                       |
| `APP_STORE_CONNECT_API_KEY_CONTENT`   | Raw contents of the `.p8` file (newlines preserved)                                                                                                                                                                                                               |
| `RELEASE_TOKEN`                       | GitHub PAT used to push the version-bump commit/tag back to `main` and to create the release. Needs `contents: write` on the Argus repo. The default `GITHUB_TOKEN` can't push past branch protection — `RELEASE_TOKEN` (issued by a human or a bot account) can. |

## Branch protection

The workflow pushes the version-bump commit + tag directly to `main`. The PAT
behind `RELEASE_TOKEN` must be either issued by an account that bypasses the
protection rule, or the rule must allow that account to push directly.

## Channels — stable, alpha, RC

The release workflow takes a **channel** input: `stable`, `alpha`, or `rc`.

| Channel  | Branch      | Tag format        | Feed file        | Pre-release flag | Side effects                             |
| -------- | ----------- | ----------------- | ---------------- | ---------------- | ---------------------------------------- |
| `stable` | `main` only | `v0.20.0`         | `latest-mac.yml` | no               | Pushes commit + tag, syncs `houwert.dev` |
| `alpha`  | any branch  | `v0.20.0-alpha.0` | `alpha-mac.yml`  | yes              | Pushes tag only; nothing else            |
| `rc`     | any branch  | `v0.20.0-rc.0`    | `beta-mac.yml`   | yes              | Pushes tag only; nothing else            |

Pre-release versioning runs `pnpm changeset pre enter <channel>` → `version` → `pre exit` (without committing the exit), so the source branch's changeset state stays untouched. Bumped versions only live in tag-space; the next `stable` cut consumes the same set of unconsumed changesets.

Stable users on the `latest` feed never see alpha/RC builds. Internal testers can switch their auto-updater channel under **Settings → Advanced → Update channel**.

## Plugin assets

Each release also publishes per-plugin asset zips, which the running app fetches when the user enables a plugin. The release workflow runs `scripts/release-plugins.ts` after the main `.app` has been signed and notarized:

1. Stage each plugin source under `release/plugin-staging/<plugin>/`.
2. Native binaries: `codesign --options runtime`, then `ditto -c -k --keepParent` into a `.zip`, then `xcrun notarytool submit … --wait`.
3. Node trees / JARs: `ditto -c -k --keepParent` only.
4. Upload each `.zip` to the same GH release tag as `<plugin>__<filename>`.

The reverse proxy at `argus.houwert.dev` rewrites `/releases/v<version>/<plugin>/<file>` → flat GH download URL. The renderer's resolver constructs the URL deterministically from `app.getVersion()` so every release is self-contained — no separate plugin versioning, no update prompts. Updating Argus = updating its plugin assets atomically.

Required env vars for `scripts/release-plugins.ts` (set automatically inside the fastlane release lane): `CSC_NAME`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_KEY_ISSUER_ID`, `APPLE_API_KEY`, `GITHUB_TOKEN`. Pass `SKIP_UPLOAD=1` to leave the staged zips on disk for inspection without uploading.
