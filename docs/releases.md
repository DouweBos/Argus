# Releasing Argus

One workflow ships every app: a signed + notarized arm64 build of Argus for
Mac (`fastlane mac mac_app_release`) uploaded to a GitHub release, the iPhone
app (`fastlane ios testflight`) uploaded to TestFlight, and the Android app
(`fastlane android release`) uploaded to Google Play's internal track, with its
APK attached to the same GitHub release. All of them carry the same version and
build number.

## TL;DR

1. Add a changeset on every PR that should appear in release notes:

   ```
   pnpm changeset
   ```

   Pick a bump (patch/minor/major) for `argus`, write a one-line summary, and
   name the app it's for in the frontmatter, then commit the `.changeset/*.md`
   file alongside the change:

   ```
   ---
   "argus": minor
   # platforms: ios
   ---

   Share a screenshot from any app straight into Argus.
   ```

   `mac`, `ios`, `android`, or a list such as `mac, ios, android` for a change
   several apps get. It's a comment
   because changesets reads every frontmatter key as a package; `pnpm lint`
   fails a changeset without one.

2. When ready to ship, go to **Actions → Release → Run workflow** on `main`.
   The workflow will:
   - Run `changeset version` to bump `package.json` + write `CHANGELOG.md`
     (`scripts/release-version.sh`).
   - If nothing changed (no pending changesets), exit cleanly. Otherwise:
   - Commit `chore: release vX.Y.Z`, tag `vX.Y.Z`, push both back to `main`.
   - Build, sign with Developer ID, notarize via App Store Connect API, staple.
   - Build the iPhone app, sign it with the App Store profiles and upload it to
     TestFlight, with the CHANGELOG section as "What to Test".
   - Build the Android app, sign it with the upload key and upload the AAB to
     Google Play's internal track, with its CHANGELOG entries as release notes.
   - Publish a GitHub release with the `.dmg`, the `.zip`, the Sparkle
     appcasts and the Android `.apk`, and the CHANGELOG section as the release
     body.

3. Send the `.dmg` link to friends.

## Version and build numbers

Every app gets `package.json`'s version and the same build number, the
workflow's run number + 2000, so `0.75.0 (2042)` names the same code on the
Mac, the iPhone and Android (where the build number is the `versionCode`). The
App Store and Play only get plain `x.y.z` versions, so a beta or alpha cut
reaches TestFlight and Play as its base version (`0.75.0-beta.1` uploads as
`0.75.0`); the build number still tells them apart.

The apps build in parallel: a `mac` and an `ios` leg of one matrix job on an
Xcode runner, and an `android` job on Linux. Each leg applies the changesets
itself (`scripts/release-version.sh`); on the same commit that always gives the
same version. A `publish` job runs once every leg has passed: it tags (and on
production pushes the version commit), then creates the GitHub release from the
Mac and Android legs' assets. A failed Apple leg cancels the other one, and any
failed leg means nothing is tagged — but a build TestFlight or Play already
took stays there.

## Release notes per app

`CHANGELOG.md` and the GitHub release list every change. Each app's own notes
only list its entries: the Mac's Sparkle update and Electron cutover feed get
the `mac` ones, TestFlight's "What to Test" the `ios` ones, Play's release notes
the `android` ones (as plain text, cut at Play's 500 characters). The changelog
generator (`scripts/changesets/changelog.ts`) marks each entry with its
platforms, and `scripts/changesets/release-notes.ts` splits the notes and
strips the markers again before anything is committed.

A release with no `ios` entries skips the iPhone leg: nothing is uploaded to
TestFlight, and the phone simply has no build with that version and build
number. The same goes for `android` entries and the Android leg (no Play upload,
no APK on the release). A release with only phone entries still ships the Mac,
with the full notes.

## iPhone setup

Once, locally, and again after adding an iPhone target (an extension, a new
bundle id in `IOS_TARGETS`):

```
MATCH_GIT_URL=https://github.com/DouweBos/apple-certificates.git \
  bundle exec fastlane ios testflight_setup
```

It creates the App Store Connect app, registers any missing extension App IDs
in the `group.dev.houwert.argus` App Group, and writes the App Store profiles
the release workflow signs with. Testers are managed in App Store Connect →
TestFlight: internal testers get every build once Apple has processed it;
external groups need a Beta App Review first.

## Android setup

The Android leg needs these once:

1. **An upload key.** Create it with
   `keytool -genkeypair -v -keystore argus-upload.jks -alias argus -keyalg RSA -keysize 4096 -validity 10000`,
   keep the `.jks` out of the repo (`*.jks` is ignored), and store it as the
   `ANDROID_KEYSTORE_BASE64` secret (`base64 -i argus-upload.jks | pbcopy`)
   with its passwords and alias below. Play App Signing holds the app signing
   key; this one only signs uploads, and the APK on the GitHub release.
2. **The Play Console app**, `dev.houwert.argus`. Play's API cannot create
   apps, and the first AAB must be uploaded by hand through the console
   (Testing → Internal testing): build one with
   `bundle exec fastlane android release upload:false` (with the keystore env
   vars and `GITHUB_RUN_NUMBER` set) and upload `release-android/*.aab`. After
   that the workflow uploads every build. Until the app's first release has
   passed review, Play only takes draft releases: set the repository variable
   `PLAY_RELEASE_STATUS` to `draft`, and remove it afterwards.
3. **A Play service account.** In Google Cloud, create a service account with a
   JSON key, then invite its email in Play Console → Users and permissions with
   release rights for the app. The JSON key is `PLAY_SERVICE_ACCOUNT_JSON`.
4. **Firebase, for push.** Create a Firebase project, add the Android app
   `dev.houwert.argus` and commit its `google-services.json` to
   `clients/android/app/`. Without the file the app builds with push off.
5. **The push relay's FCM credentials.** The relay at `houwert.dev/argus/push`
   sends Android notifications (`service: "fcm"`) through FCM's HTTP v1 API, so
   it needs a service account of that same Firebase project with the Firebase
   Cloud Messaging role.

Every channel uploads to the internal track, as every channel reaches
TestFlight on the iPhone: internal testers get betas and alphas too. Promote a
build to closed, open or production testing in the Play Console.

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
| `MATCH_GIT_PAT`                       | Personal access token with read access to the cert repo; the workflow encodes it for match                                                                                                                                                                        |
| `MATCH_PASSWORD`                      | The shared password the cert repo is encrypted with                                                                                                                                                                                                               |
| `MATCH_KEYCHAIN_PASSWORD`             | Any random string — used to unlock the throwaway CI keychain                                                                                                                                                                                                      |
| `APP_STORE_CONNECT_API_KEY_ID`        | Key ID of the App Store Connect API key (e.g. `ABCD1234`)                                                                                                                                                                                                         |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | Issuer UUID for the API key                                                                                                                                                                                                                                       |
| `APP_STORE_CONNECT_API_KEY_CONTENT`   | Raw contents of the `.p8` file (newlines preserved)                                                                                                                                                                                                               |
| `ANDROID_KEYSTORE_BASE64`             | The Android upload keystore (`.jks`), base64-encoded; decoded into the runner's temp dir for the build                                                                                                                                                            |
| `ANDROID_KEYSTORE_PASSWORD`           | The upload keystore's password                                                                                                                                                                                                                                    |
| `ANDROID_KEY_ALIAS`                   | The upload key's alias in the keystore                                                                                                                                                                                                                            |
| `ANDROID_KEY_PASSWORD`                | The upload key's password                                                                                                                                                                                                                                         |
| `PLAY_SERVICE_ACCOUNT_JSON`           | JSON key of the Google Play service account `supply` uploads with                                                                                                                                                                                                 |
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
