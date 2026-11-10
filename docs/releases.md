# Releasing Argus

Cuts a signed + notarized arm64 build of Argus for Mac (`fastlane mac
mac_app_release`) and uploads it to a GitHub release.

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
   - Publish a GitHub release with the `.dmg`, the `.zip` and the Sparkle
     appcasts, and the CHANGELOG section as the release body.

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

## Channels — production, beta, alpha

The release workflow takes a **channel** input: `production`, `beta`, or `alpha`.

| Channel      | Branch      | Tag format        | Feed file              | Pre-release flag | Subscribable in app | Side effects                             |
| ------------ | ----------- | ----------------- | ---------------------- | ---------------- | ------------------- | ---------------------------------------- |
| `production` | `main` only | `v0.20.0`         | `argus-mac-latest.xml` | no               | yes (default)       | Pushes commit + tag, syncs `houwert.dev` |
| `beta`       | `main` only | `v0.20.0-beta.0`  | `argus-mac-beta.xml`   | yes              | yes                 | Pushes tag only; nothing else            |
| `alpha`      | any branch  | `v0.20.0-alpha.0` | `argus-mac-alpha.xml`  | yes              | no — manual install | Pushes tag only; nothing else            |

A release is listed in its own channel's feed and every less stable one: a production cut also goes into the beta and alpha feeds, a beta cut into the alpha feed. Beta installs therefore update to a production build once it outpaces the latest beta.

**Production** cuts are the public releases — they push the changeset version-bump commit + tag to `main` and notify `houwert.dev` so the marketing site rebuilds its public changelog.

**Beta** cuts are in-development builds of upcoming features, intended to work but not yet vetted. They can only be cut from `main` so the beta feed always tracks ahead of production along the same line of history. Anyone can subscribe by switching to **Beta** under **Settings → Advanced → Update channel**.

**Alpha** cuts are one-off builds from any branch, used to share a work-in-progress with someone else. They are **not** offered as a channel in Settings — repo collaborators install the `.dmg` manually from the GitHub release page. The `argus-mac-alpha.xml` appcast is still published, but no in-app UI selects it.

Pre-release versioning (beta/alpha) runs `pnpm changeset pre enter <channel>` → `version` → `pre exit` (without committing the exit), so the source branch's changeset state stays untouched. Bumped versions only live in tag-space; the next `production` cut consumes the same set of unconsumed changesets.

## Tool assets

Tool assets (`argus-sim-bridge`, `scrcpy-server.jar`, the conductor tree) ship bundled with the app, staged next to the host by `pnpm build:mac-host`. Toggling tools on or off in Settings affects whether their UI surfaces and host handlers are active — it doesn't move binaries around. Updating Argus updates its tool assets atomically as part of the standard auto-update flow.

## Moving Electron installs over

Production cuts also publish `cutover-mac.yml`, a feed in electron-updater's
format. Still-installed Electron apps read it and update
into Argus for Mac (see [Moving from the Electron app](mac-app.md#moving-from-the-electron-app)).
Beta and alpha cuts never publish it, so no Electron user lands on a
pre-release.
