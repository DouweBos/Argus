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

| Secret | Used for |
| --- | --- |
| `MATCH_GIT_URL` | HTTPS URL of the `apple-certificates` repo (e.g. `https://github.com/DouweBos/apple-certificates.git`) |
| `MATCH_GIT_BASIC_AUTHORIZATION` | Base64 of `username:personal_access_token` for the cert repo (PAT needs `repo` read) |
| `MATCH_PASSWORD` | The shared password the cert repo is encrypted with |
| `MATCH_KEYCHAIN_PASSWORD` | Any random string — used to unlock the throwaway CI keychain |
| `APP_STORE_CONNECT_API_KEY_ID` | Key ID of the App Store Connect API key (e.g. `ABCD1234`) |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | Issuer UUID for the API key |
| `APP_STORE_CONNECT_API_KEY_CONTENT` | Raw contents of the `.p8` file (newlines preserved) |
| `RELEASE_TOKEN` | GitHub PAT used to push the version-bump commit/tag back to `main` and to create the release. Needs `contents: write` on the Argus repo. The default `GITHUB_TOKEN` can't push past branch protection — `RELEASE_TOKEN` (issued by a human or a bot account) can. |

## Branch protection

The workflow pushes the version-bump commit + tag directly to `main`. The PAT
behind `RELEASE_TOKEN` must be either issued by an account that bypasses the
protection rule, or the rule must allow that account to push directly.
