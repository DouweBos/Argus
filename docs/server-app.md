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

## When the files are on the other Mac

A desktop attached to a host draws the same UI, but the repo is on the host's
disk. Everything that touches a filesystem resolves on the host; the handful of
actions that only make sense where the window is stay local.

| action                                           | attached to a host                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Add project                                      | browses the **host's** folders, not yours                                       |
| Reveal in Finder, Open, Open in editor           | refused with a notice — Argus never syncs a worktree back                       |
| OAuth and other external links                   | open in **your** browser                                                        |
| Dropping a file into the chat, importing a patch | the bytes are uploaded to the host, and the mention points at where they landed |
| Images pasted or dropped into the chat           | already travel as bytes; unchanged                                              |

### Uploaded attachments

A dropped file's path belongs to the machine you dropped it on, which is why
the bytes travel instead. They are staged under `$ARGUS_HOME/uploads/<session>/`
on the host — never inside the worktree, so nothing shows up in the session's
diff — and staged files are swept seven days after their last use.

The bytes move as a chunked binary transfer over the same encrypted connection
that carries device video, not as one giant message, so a screen recording or a
large patch goes through the way a small text file does. The chat shows a
progress bar while a drop is uploading, and the transfer is only accepted once
its length and checksum both match — a connection that drops mid-upload leaves
nothing half-written behind.

One upload is capped at **512 MB**, a limit on what the host is willing to stage
on its own disk. It is enforced on the host as the bytes arrive, and an oversize
file is refused by name rather than truncated; put a bigger one on the host
yourself.

### What a client may read and write

`read_file` and `write_file` are reachable by an admin-paired desktop. Both
resolve their target, follow symlinks, and refuse anything that lands outside
the session's worktree or a registered project root — a symlink inside the
worktree pointing at `~/.ssh` is not a way out. Chunked transfers go through the
same check, once, when the transfer opens: a chunk carries a transfer id and
nothing else, so there is no later opportunity to redirect where it lands.

### Git errors keep their detail

A failed git command carries a kind, the raw stderr and a suggested recovery.
That structure survives the connection, so a push rejected on the host offers
the same "pull then push" action it would locally.

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

## Pairing your first device

The server has no window, so pairing happens in the tray:

**Pair a device…** arms a pairing session, copies the pairing code to the
clipboard, and writes it to `$ARGUS_HOME/pairing-code.txt` (mode 0600) for a
machine you only reach over SSH — the code is far too long to read off a menu
item. Paste it into the desktop's _Add host_ field.

When the desktop connects, the menu shows a six-digit number. **Compare it
against the one on the desktop's screen** — that comparison is what makes a
man-in-the-middle impossible, and it is the reason pairing can never happen over
the wire. If they match, approve:

| choice                     | grants                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| **Approve — full control** | `admin` — drives the host as if you were sitting at it. What you want for a mini you own. |
| **Approve — view only**    | `monitor` — watches agents, changes nothing.                                              |

**Reject** if the numbers differ. The code file is deleted the moment pairing
settles either way, and on quit.

If the menu says _no reachable address_, the gateway has no LAN address or
tunnel yet — check the network, or turn on a tunnel.

This is the same flow the desktop runs in a dialog, on a different surface. It
is not the `ARGUS_DEV_TRUST` bypass, which skips the comparison entirely and
cannot run in a packaged build.

## Updating the server

A mini nobody sits at still needs new builds, and the install command is
deliberately host-tier — a client must never restart a host out from under
someone else's running agents. So updating happens in the tray, next to pairing.

The menu shows where the update stands:

| menu says                  | meaning                                                       |
| -------------------------- | ------------------------------------------------------------- |
| **Check for Updates…**     | nothing known yet, or the last check came back clean          |
| _Checking for updates…_    | a feed check is in flight                                     |
| _Up to date_               | the running version is the newest on the channel              |
| _Update available: 1.2.3_  | pick **Download Update** — downloads never start on their own |
| _Downloading update — 42%_ | progress; the menu updates live                               |
| _Update ready: 1.2.3_      | pick **Restart and Install**                                  |
| _Update failed: …_         | the feed error, shortened; **Check for Updates…** retries     |

The running version is the first line of the menu, so only the new version is
named here.

Checks also run in the background once an hour, the same as the desktop. That is
already far tighter than a machine that runs for weeks needs, so the server adds
no second timer.

### Restarting is refused while agents are running

Installing an update quits the process, which kills every agent on the machine.
So **Restart and Install** is replaced by a disabled `3 agents running — cannot
restart` whenever anything is working — including an agent whose prompt is still
in flight between tool calls. Stop or wait out the agents and the item comes
back. It never restarts silently, and the count tells you what it is waiting on.

### Install automatically when idle

**Install Automatically When Idle** is a checkbox in the same section, **off by
default**. With it on, a downloaded update installs itself the moment the last
agent finishes — the same guard, just without a human to click it. The server
re-checks for idleness every minute, so an unattended restart lands within about
a minute of the fleet going quiet.

Off by default because a mini rebooting unprompted is a surprise; turn it on for
a machine you want to stay current without visiting.

The setting is stored in `$ARGUS_HOME/app-settings.json` as
`server_auto_install_updates`.

## The tray is the whole UI

The server's only surface is the menu-bar item: the same live agent tree the
desktop shows, plus its version, gateway URL and state directory, the pairing
and update flows above, and Quit. Menu entries don't navigate anywhere — there is no window
to navigate.

Quitting the server does not prompt about running agents the way the desktop
does; there is no renderer to ask. It tears down PTYs and agent subprocesses and
exits.
