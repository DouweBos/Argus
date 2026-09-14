# Local development environment

How to run a development build of Argus alongside your installed production
copy without the two stepping on each other's data.

## TL;DR

```
pnpm dev
```

`pnpm dev` is **isolated by default**. It points the dev build at a
parallel `~/.argus-dev/` state directory so your prod install's
`config.json`, `tools.json`, sessions, and worktrees
stay untouched. Electron's `userData` dir (Application Support) is
already routed to `argus-dev` separately.

## What gets isolated

| Thing                             | Prod install                           | `pnpm dev`                                 |
| --------------------------------- | -------------------------------------- | ------------------------------------------ |
| `config.json`, `tools.json`, etc. | `~/.argus/`                            | `~/.argus-dev/`                            |
| Worktrees                         | `~/.argus/worktrees/`                  | `~/.argus-dev/worktrees/`                  |
| Agent logs                        | `~/.argus/agents/`                     | `~/.argus-dev/agents/`                     |
| Tool asset cache                  | `~/Library/Application Support/Argus/` | `~/Library/Application Support/argus-dev/` |
| Single-instance lock              | (in `userData`)                        | (in dev `userData`)                        |

The two installs can run concurrently. Different process trees, different
on-disk state, different update channel preferences, different tool
toggles.

## Running against your prod state

If you specifically want to repro a bug against your real data:

```
pnpm dev:prod-state
```

This runs the dev build with **no** `ARGUS_HOME` override, so it shares
`~/.argus/` with the installed app. Note that:

- Worktrees created by the dev build still live under
  `~/.argus/worktrees/` and the prod install will see them.
- The single-instance lock is shared via `userData`, so opening the dev
  build while the packaged app is running is a no-op (and vice versa).

## Custom isolation directory

`ARGUS_HOME` is a regular env var — set it to anything you want:

```
ARGUS_HOME="$HOME/.argus-experiment-12" pnpm dev
```

Useful for keeping multiple dev profiles around (one for testing the
tool onboarding flow on a "fresh install", another for the migration
flow on an "existing install").

To simulate a brand-new user: `rm -rf "$ARGUS_HOME"` before launch.
To simulate an existing-user-upgrading: copy your prod
`~/.argus/config.json` into `$ARGUS_HOME/` first, then launch — the
tool migration will run against it and seed every tool to enabled.

## Testing alpha/RC builds

Pre-release `.app` bundles published via `release.yml`'s `alpha` or `rc`
channel install side-by-side with stable since they're notarised under
the same `Argus.app` name — they DO share `~/.argus/` and `userData`
with the stable install. If you want them isolated, launch them with an
`ARGUS_HOME` override:

```
ARGUS_HOME="$HOME/.argus-alpha" /Applications/Argus.app/Contents/MacOS/Argus
```

…or copy the alpha build to a renamed `.app` (e.g. `Argus Alpha.app`)
before installing — Electron derives `userData` from the bundle name.
