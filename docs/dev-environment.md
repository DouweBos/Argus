# Local development environment

How to run a development build of Argus alongside your installed production
copy without the two stepping on each other's data.

## TL;DR

Run the `ArgusDesktop` scheme in `clients/apple/ArgusRemote.xcodeproj`, or:

```
xcodebuild -project clients/apple/ArgusRemote.xcodeproj -scheme ArgusDesktop \
  -destination 'platform=macOS' build
```

A Debug build ("Argus Dev") is **isolated by default**. It never defaults to
`~/.argus`: its host runs on a parallel `~/.argus-mac-dev/` state directory,
so your prod install's settings, sessions and worktrees stay untouched.

## What gets isolated

| Thing                   | Prod install          | Debug build ("Argus Dev")     | `pnpm dev:host`                |
| ----------------------- | --------------------- | ----------------------------- | ------------------------------ |
| State (`ARGUS_HOME`)    | `~/.argus/`           | `~/.argus-mac-dev/`           | `~/.argus-host-dev/`           |
| Worktrees               | `~/.argus/worktrees/` | `~/.argus-mac-dev/worktrees/` | `~/.argus-host-dev/worktrees/` |
| Host lock (`host.lock`) | `~/.argus/`           | `~/.argus-mac-dev/`           | `~/.argus-host-dev/`           |
| `argus://` links        | claimed               | `argus-mac-dev://` instead    | —                              |

The installs can run concurrently: different processes, different on-disk
state, different settings.

## Running against your prod state

If you want to repro a bug against your real projects and agents, start a
Debug build with `ARGUS_ATTACH_HOME=~/.argus`. It then only ever attaches to
the Argus already running on that home, as a second window: it never starts a
host there, takes the lock, offers to take over, or copies its settings in.
With nothing running it waits for one. Never point a dev build's `ARGUS_HOME`
at `~/.argus` instead — two hosts on the same state would fight over the same
worktrees and agents.

## Custom isolation directory

`ARGUS_HOME` is a regular env var — set it in the scheme's environment, or
for the plain Node host:

```
ARGUS_HOME="$HOME/.argus-experiment-12" pnpm dev:host
```

Useful for keeping multiple dev profiles around (one for testing onboarding on
a "fresh install", another for a migration on an "existing install").

To simulate a brand-new user: `rm -rf "$ARGUS_HOME"` before launch.

## Testing alpha/beta builds

Pre-release `.app` bundles published via `release.yml`'s `beta` or `alpha`
channel install as the same `Argus.app`, so they share `~/.argus/` with the
stable install. If you want them isolated, quit Argus and launch the build
with an `ARGUS_HOME` override:

```
ARGUS_HOME="$HOME/.argus-alpha" /Applications/Argus.app/Contents/MacOS/Argus
```
