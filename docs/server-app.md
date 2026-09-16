# Argus Server — the headless host app

`Argus Server.app` is Argus with no window. It runs the whole service layer —
agents, worktrees, terminals, simulators, the remote gateway — on a machine
nobody is sitting at, typically a Mac mini, so agents keep working while your
laptop comes and goes.

It is built from the same codebase as the desktop app, as a **second
electron-builder target**. It is not a flag on `Argus.app`, and that is
deliberate: `app.requestSingleInstanceLock()` quits the second instance, and the
lock is keyed on the userData path derived from the app id. Two distinct app ids
means two distinct locks, which is the only reason a server and a desktop can
run on the same Mac at all — local development of remote access depends on it.

|                      | Argus               | Argus Server               |
| -------------------- | ------------------- | -------------------------- |
| App id               | `dev.houwert.argus` | `dev.houwert.argus.server` |
| State (`ARGUS_HOME`) | `~/.argus`          | `~/.argus-server`          |
| Gateway port         | 47615               | 47617                      |
| Window               | yes                 | none — tray item only      |
| Dock tile            | yes                 | no (`LSUIElement`)         |
| `argus://` links     | claims the scheme   | never claims it            |
| Distribution         | `.dmg`              | `.app` only                |

The server ships the same payload as the desktop: the simulator bridge,
`scrcpy-server.jar`, the agent prompts, the conductor tree, and the
`clients/argus-web` bundle — the server is what serves that bundle to phones and
browsers.

## Fully standalone state

The server never shares anything with a co-located desktop. Its `ARGUS_HOME`
defaults to `~/.argus-server`, so it gets its own worktrees, `tools.json`,
paired-device keys, Claude accounts, chat history and app settings. Two
processes running git in one worktree is not a thing to design for.

`ARGUS_HOME` still overrides the default, on both apps.

The gateway is not a setting on the server — it is the only way in, so it is
forced on at startup regardless of `remote_enabled`.

## Building

```
pnpm build:app          # Argus.app + .dmg           → release/
pnpm build:app:server   # Argus Server.app           → release-server/
```

The server config lives in `scripts/electron-builder-server.config.cjs`, derived
from `electron-builder.yml` so the two can't drift on bundled resources. It
overrides the app id, product name and output directory, points the packaged
`main` at `dist-electron/server.js`, drops the DMG and the Dock tile, and
removes the usage strings only a window can trigger. Both targets run
`scripts/electron-after-pack.cjs`.

`dist-electron/server.js` is the same bundle as `main.js` with an esbuild banner
that sets `ARGUS_SERVER=1` (and the default gateway port) before the first
module loads — early enough that `ARGUS_HOME` is already correct when services
read it at import time.

## Running one next to your desktop, for development

```
pnpm dev         # desktop, ~/.argus-dev,        gateway 47616
pnpm dev:server  # headless, ~/.argus-server-dev, gateway 47617
```

`pnpm dev:server` needs no Vite — there is no renderer. It builds the main
process and launches Electron with `ARGUS_SERVER=1`, a separate `userData`
(`argus-server-dev`, hence a separate single-instance lock), and
`ARGUS_DEV_TRUST=1`.

### Dev-loopback pairing

Pairing normally shows a 6-digit SAS on both ends and waits for a human to
confirm they match. That assumes two devices and two screens; a headless server
has neither, and pairing a desktop to a server on the same Mac has nothing to
compare against.

With `ARGUS_DEV_TRUST=1` **and an unpackaged build**, the server arms a pairing
session against `ws://127.0.0.1:<port>`, auto-confirms the SAS, and writes the
pairing code to `$ARGUS_HOME/dev-pairing.json`:

```json
{
  "created_at": 1770000000000,
  "pairing_code": "eyJ2IjoxLC…",
  "payload": {
    "v": 1,
    "url": "ws://127.0.0.1:47617",
    "ds_pub": "…",
    "pairing_secret": "…"
  }
}
```

Paste `pairing_code` into the client. The file is rewritten whenever the server
re-arms, so it always holds the current code, and it is deleted on quit.

This bypasses the anti-MITM confirmation, so it is gated twice: on the env var
and on `app.isPackaged` being false. It cannot happen in a release build.

## Unattended operation on a Mac mini

### Auto-login is required

CoreSimulator needs a logged-in Aqua session. `simctl boot` fails under a
launchd **daemon**, so the server must run as a launchd **agent** inside a real
user login — which means the mini has to be set to log in automatically:

System Settings → Users & Groups → Automatic log in → pick the Argus user.

FileVault blocks auto-login at first boot. Either leave FileVault off on a
physically secured machine, or accept that a cold boot needs one manual unlock.

### Install the launchd agent

```
pnpm build:app:server
cp -R "release-server/mac-arm64/Argus Server.app" /Applications/
pnpm server:install-agent                        # or: … /path/to/Argus Server.app
```

That renders `build/dev.houwert.argus.server.plist` into
`~/Library/LaunchAgents/` and bootstraps it into the GUI domain. It starts at
login and restarts on crash. Logs land in `~/.argus-server/launchd.{out,err}.log`
alongside Argus's own rotating log.

```
launchctl print gui/$(id -u)/dev.houwert.argus.server   # status
pnpm server:install-agent --uninstall                   # remove
```

### Staying awake

The server holds a `caffeinate -i -m -s` power assertion for as long as it runs
— a sleeping mini stops agents mid-run and drops every attached client. The
assertion is tied to the server's pid (`-w`), so a crash can't leave the machine
pinned awake. The display is free to sleep.

For a mini on mains power, also set System Settings → Energy → "Prevent
automatic sleeping when the display is off".

## The tray is the whole UI

The server's only surface is the menu-bar item: the same live agent tree the
desktop shows, plus its version, gateway URL and state directory, and Quit.
Menu entries don't navigate anywhere — there is no window to navigate.

Quitting the server does not prompt about running agents the way the desktop
does; there is no renderer to ask. It tears down PTYs and agent subprocesses and
exits.
