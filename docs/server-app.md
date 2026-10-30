# Argus Server — the headless host app

Argus Server is Argus with no window. It runs the whole service layer —
agents, worktrees, terminals, simulators, the remote gateway and the web
client — on a machine nobody is sitting at, typically a Mac mini, so agents
keep working while your laptop comes and goes. Its only surface is an item in
the menu bar.

It is a native Mac app built from `clients/apple` (the `ArgusServer` target),
a sibling of [Argus for Mac](mac-app.md): it bundles and supervises the same
Node host core the Mac app does, in a server mode. It replaces the Electron
build of Argus Server, which is deprecated (see
[Moving from the Electron server](#moving-from-the-electron-server)).

|                      | Argus for Mac       | Argus Server               |
| -------------------- | ------------------- | -------------------------- |
| Bundle id            | `dev.houwert.argus` | `dev.houwert.argus.server` |
| State (`ARGUS_HOME`) | `~/.argus`          | `~/.argus-server`          |
| Gateway port         | 47615               | 47617                      |
| Window               | yes                 | none — menu bar item only  |
| Dock tile            | yes                 | no (`LSUIElement`)         |
| `argus://` links     | claims the scheme   | never claims it            |
| Distribution         | `.dmg`              | notarized `.zip`           |
| Macs                 | Apple silicon       | Apple silicon              |

The server ships the same payload as the Mac app: the Node runtime, the host,
the simulator bridge, `scrcpy-server.jar`, the agent prompts, the conductor
tree, the language servers and the `clients/argus-web` bundle — the server is
what serves that bundle to phones and browsers.

## Fully standalone state

The server never shares anything with a co-located desktop. Its `ARGUS_HOME`
is `~/.argus-server`, so it gets its own worktrees, `tools.json`, paired-device
keys, Claude accounts, chat history and app settings. Two processes running git
in one worktree is not a thing to design for. Only one Argus Server runs per
Mac user, and the host lock keeps any other app off its home.

`ARGUS_HOME` still overrides the default.

Its open projects live in `repo-roots.json` under that same directory and are
re-registered at launch, so the server comes back from every restart with the
projects clients attach to.

The gateway is not a setting on the server — it is the only way in, so it is
forced on at startup regardless of `remote_enabled`.

## Building

```
xcodebuild -project clients/apple/ArgusRemote.xcodeproj -scheme ArgusServer \
  -destination 'platform=macOS' build                      # Debug
xcodebuild … -scheme ArgusServer -destination 'platform=macOS' test
bundle exec fastlane mac mac_server_release              # notarized release
```

Like the Mac app, its build phase stages the host with
`scripts/build-mac-host.ts` into `Contents/Resources/host` and signs it. A
second phase embeds the launch agent behind **Open at Login** in
`Contents/Library/LaunchAgents`. Release builds are signed with the Developer ID
certificate and no provisioning profile: the server needs no profile-bound
entitlement (it never signs in with Apple; it links to the account with a code).

`mac_server_release` archives the Release build, exports it for Developer ID,
notarizes and staples it, zips it as `Argus-Server-<version>-arm64.zip`, writes
the Sparkle appcast for its channel (`argus-server-latest.xml`,
`argus-server-beta.xml` or `argus-server-alpha.xml`) and uploads both to the
version's GitHub release, where `houwert.dev/argus/updates/` serves them. It
needs `SPARKLE_PUBLIC_ED_KEY` (baked into the build) and
`SPARKLE_ED_PRIVATE_KEY` (signs the appcast) next to the usual App Store
Connect key. A build without a public key never checks for updates.

## Running one next to your desktop, for development

A Debug build never touches the real server: it runs on
`~/.argus-mac-server-dev` with its gateway on port 48116, has its own bundle id
(`dev.houwert.argus.server.dev`, shown as "Argus Server Dev") and its own login
item. `ARGUS_HOME` and `ARGUS_REMOTE_PORT` override both. Never point a dev
server at `~/.argus-server`.

The repository's **Mac server** run command builds it into
`.build/mac-server-dd` and starts it on `~/.argus-mac-server-dev-<port>` with
port `48116 + offset`, so each worktree gets its own; Debug builds skip the
one-copy-per-user check for that reason, leaving the host lock to keep homes
apart.

### Dev-loopback pairing

Pairing normally shows a 6-digit SAS on both ends and waits for a human to
confirm they match. That assumes two devices and two screens; a headless server
has neither, and pairing a desktop to a server on the same Mac has nothing to
compare against.

A Debug build starts its host with `ARGUS_DEV_TRUST=1`. The host then arms a
pairing session against `ws://127.0.0.1:<port>`, auto-confirms the SAS, and
writes the pairing code to `$ARGUS_HOME/dev-pairing.json`:

```json
{
  "created_at": 1770000000000,
  "pairing_code": "eyJ2IjoxLC…",
  "payload": {
    "v": 1,
    "url": "ws://127.0.0.1:48116",
    "ds_pub": "…",
    "pairing_secret": "…"
  }
}
```

Paste `pairing_code` into the client. The file is rewritten whenever the host
re-arms, so it always holds the current code, and it is deleted on quit.

This bypasses the anti-MITM confirmation, so it is gated twice: on the
variable, which only a Debug build sets, and on the host not running from an
installed app — it refuses whenever its resources sit under an `Applications`
folder. `argus-host` honours the same variable under the same gate.

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

A mini that stays awake is the machine to run [automations](./automations.md)
on: the scheduler starts with the app, needs no window, and keeps triaging
overnight while your laptop is shut. A paired desktop granted admin manages the
server's automations as if they were its own.

### Auto-login is required

CoreSimulator needs a logged-in Aqua session. `simctl boot` fails under a
launchd **daemon**, so the server must run as a launchd **agent** inside a real
user login — which means the mini has to be set to log in automatically:

System Settings → Users & Groups → Automatic log in → pick the Argus user.

FileVault blocks auto-login at first boot. Either leave FileVault off on a
physically secured machine, or accept that a cold boot needs one manual unlock.

### Open at Login

**Open at Login** in the menu registers the server's own launch agent with
macOS (`SMAppService`), so it shows up in System Settings → General → Login
Items like any other login item. It starts the server when you log in and
brings it back if it crashes; **Quit** exits cleanly, so it stays quit until
the next login. If macOS wants you to allow it first, the menu says **Allow in
Login Items…** and opens the right pane.

The server writes its host's output to `~/.argus-server/logs/host.log` (rolled
at 10 MB), next to the host's own rotating log; **Open Logs** shows the folder.
The host is restarted if it crashes, and after five crashes in two minutes the
menu says _Host: failed_ with **Restart Host**.

### Staying awake

The host holds a `caffeinate -i -m -s` power assertion for as long as it runs
— a sleeping mini stops agents mid-run and drops every attached client. The
assertion is tied to the host's pid (`-w`), so a crash can't leave the machine
pinned awake. The display is free to sleep.

For a mini on mains power, also set System Settings → Energy → "Prevent
automatic sleeping when the display is off".

## The menu

| section       | shows                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| status        | the version, whether the host is running, the gateway, the local network and Tailscale addresses with **Copy Address**, and the state folder (click to show it)  |
| agents        | how many agents run and how many are active, then each project → session → agent; picking an agent opens it in the web client                                    |
| Argus Account | linking, the account's view of this computer, the managed tunnel, who is waiting to join, and the account settings — see [From the menu bar](#from-the-menu-bar) |
| pairing       | **Pair a device…** and the pairing in progress                                                                                                                   |
| updates       | where an update stands, and **Install Automatically When Idle**                                                                                                  |
| open          | **Open Web Client** (`http://127.0.0.1:47617/` in your browser) and **Open Logs**                                                                                |
| app           | **Open at Login**, **Settings…** (start at login, updates, usage data, the account's settings and paired devices with their grants) and **Quit Argus Server**    |

When another app holds `~/.argus-server`, the menu says which and offers to
take over from it instead; when a pairing or a join request needs someone at
the server, a notification says so and opens it.

Everything else — Claude accounts, MCP servers, LLM runners, tools — is
managed from a paired desktop granted full control, as if it were that
desktop's own host.

## Pairing your first device

**Pair a device…** opens a small window with a QR code to scan with Argus on
your phone and the pairing code to paste into a desktop's _Add host_ field. The
code is also copied to the clipboard and written to
`$ARGUS_HOME/pairing-code.txt` (mode 0600) for a machine you only reach over
SSH.

When the device connects, the window and the menu show a six-digit number.
**Compare it against the one on the device's screen** — that comparison is
what makes a man-in-the-middle impossible, and it is the reason pairing can
never happen over the wire. If they match, approve from the window or the menu:

The server decides what the device may do. The device never asks for a tier, and
nothing it sends afterwards can widen one — pairing and grant changes are
host-tier commands that never cross the wire. Pick the narrowest that works:

| choice                                 | grants    | what it can do                                                                                                                                                                                        |
| -------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Approve — watch only**               | `monitor` | Read agents, sessions and device screens. Cannot answer a tool-use prompt, which is a code-execution act.                                                                                             |
| **Approve — run agents**               | `control` | The above, plus send messages, spawn agents, create sessions, answer prompts, commit/push/merge a session's branch, open and merge pull requests, and author automations. The right tier for a phone. |
| **Approve — full control of this Mac** | `admin`   | Drives the host as if you were at its keyboard — every command except the host-only set. Only for a Mac you own.                                                                                      |

Least privilege is listed first deliberately: `admin` inverts the allowlist to a
denylist, so it should be a deliberate reach rather than the obvious click. You
can change a device's grants later, or revoke it, from the server's Settings →
Account & Remote, or from a desktop granted full control.

**Reject** if the numbers differ. The code file is deleted the moment pairing
settles either way, and on quit.

## Linking to your Argus account

Instead of pairing each device with a code, a host can join your
[Argus account](accounts.md), so every device signed in to it can find and
connect to the host on its current address. On Argus Server, link from the
menu bar (below); on a bare `argus-host`, link from the terminal it runs in
(or start it as `argus-host login` over SSH):

```
$ argus-host login
  Open https://houwert.dev/argus/link and enter  WDJB-MJHT   (expires in 10 min)
  or type the code into the Argus app on your phone or Mac.
  Waiting…
Approval requested by "Douwe's iPhone". Code there: 482 093
Does it match? [y/N] y
Confirmed here. Waiting for the other side to finish…
Linked. This computer now shows up on your devices.
```

Compare the six-digit code with the one on your phone before you answer `y`,
for the same reason as with pairing. On an empty account the host asks whether
to become the account's first computer instead.

The other account words:

| word                        | does                                                                                                                                                                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account`                   | Shows whether the host is linked, the account safety code, every computer on the account with online/offline, its devices, and how many are waiting to join                                                                                                                                               |
| `account set <key> <value>` | Changes this host's account settings: `enabled`, `lan`, `tailscale`, `cloudflare`, `approve`, `tunnel` (`on`/`off`), `ios` (`monitor`/`control`), `desktop` (`monitor`/`control`/`admin`), `service` (a URL or `default`), `name` (this computer's name on the account, or `default` for the system name) |
| `approve [n]`               | Approves a computer or a device (a phone or Mac that signed in) waiting to join, from this console — with the same code comparison. Turned off by `account set approve off`                                                                                                                               |
| `logout`                    | Unlinks this host. QR-paired devices keep working                                                                                                                                                                                                                                                         |

`approve` is also the way back in when you've lost every device: sign in on the
new phone, then type `approve` here and compare the code it shows.

Once linked, the host publishes its addresses (signed with its own account key)
when a route or the LAN changes and every five minutes, and accepts devices
the account lists with the grants from `account set ios|desktop`.

### From the menu bar

Argus Server's menu carries the same flow, backed by the same host commands as
the console words. **Link to Argus Account…** also opens a window with the code
in large type, and **Approve…** one with the code to compare.

| menu shows                                | does                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Link to Argus Account…**                | `login`: copies the code to the clipboard and shows it with the `houwert.dev/argus/link` address (**Open** it, or type the code into the Argus app). **Cancel Linking** stops it                  |
| _Confirm this matches: 482 093_           | the six-digit comparison. **Codes Match — Link** or **Codes Differ — Cancel**; on an empty account, **Make This Computer the First** instead                                                      |
| _Argus Account: linked as "Mini"_         | `account`: the name it's linked as, whether the account sees it online, and the managed tunnel's state and address                                                                                |
| **Waiting to join (n)**                   | `approve`: pick who, then **Approve…** shows the code to compare (**Codes Match — Approve** / **Codes Differ — Deny**), or **Deny**. Says _approving here is off_ after `account set approve off` |
| **Argus Account → Managed Tunnel**        | `account set tunnel on\|off`                                                                                                                                                                      |
| **Argus Account → This Computer's Name…** | `account set name`, in a small prompt; **Use System Name** goes back to the default                                                                                                               |
| **Argus Account → Unlink…**               | `logout`, after a confirmation                                                                                                                                                                    |

Who is waiting to join and whether the account sees the server online are
checked once a minute; everything else updates as it happens.

A linked host with remote access on also runs its own **managed tunnel**, so
devices reach it from anywhere (see
[Reaching your computers from anywhere](accounts.md#reaching-your-computers-from-anywhere)).
The first time, the host downloads a pinned `cloudflared` into
`$ARGUS_HOME/bin/cloudflared/` and checks its SHA-256 before running it; set
`ARGUS_CLOUDFLARED_PATH` to use your own binary instead (handy on a machine
with no outbound access to GitHub). `account` shows the tunnel's state and
address; `account set tunnel off` turns it off, leaving the LAN and Tailscale.

## Updating the server

A mini nobody sits at still needs new builds, and the install command is
deliberately host-tier — a client must never restart a host out from under
someone else's running agents. So updating happens in the menu.

The server checks its feed once an hour, on the channel picked in Settings
(`updater_channel`, shared with the desktop). Sparkle replaces the whole app,
the bundled host included, so the two never drift apart.

| menu says                  | meaning                                                       |
| -------------------------- | ------------------------------------------------------------- |
| **Check for Updates…**     | nothing known yet                                             |
| _Checking for updates…_    | a feed check is in flight                                     |
| _Up to date_               | the running version is the newest on the channel              |
| _Update available: 1.2.3_  | pick **Download Update** — downloads never start on their own |
| _Downloading update — 42%_ | progress; the menu updates live                               |
| _Update ready: 1.2.3_      | pick **Restart and Install**                                  |
| _Update failed: …_         | the feed error, shortened; **Check for Updates…** retries     |

The running version is the first line of the menu, so only the new version is
named here.

### Restarting is refused while agents are running

Installing an update quits the server, which stops every agent on the machine.
So **Restart and Install** is replaced by a disabled `3 agents running — cannot
restart` whenever anything is working. Stop or wait out the agents and the item
comes back. It never restarts silently, and the count tells you what it is
waiting on.

### Install automatically when idle

**Install Automatically When Idle** is a checkbox in the same section, **off by
default**. With it on, a new version is downloaded as soon as it is found and
installed the moment the last agent finishes — the same guard, just without a
human to click it. The server re-checks for idleness every minute, so an
unattended restart lands within about a minute of the fleet going quiet.

Off by default because a mini restarting unprompted is a surprise; turn it on
for a machine you want to stay current without visiting.

The setting is stored in `$ARGUS_HOME/app-settings.json` as
`server_auto_install_updates`, the same key the Electron server used.

## Quitting

**Quit Argus Server** with agents running asks first: **Quit** lets them stop
cleanly and save, which can take a few seconds; **Quit Now** stops them at
once. With nothing running it just quits. Either way the host shuts down its
terminals and agent processes before the app exits.

## Moving from the Electron server

The native app keeps the Electron server's bundle id, its `~/.argus-server`
and its port, so it drops in: paired devices, the account link, sessions,
worktrees, settings and the macOS privacy permissions you granted (Full Disk
Access and the like) all carry over.

- **From the old server's menu.** The last Electron server checks the native
  app's feed and offers _New Argus Server available_ → **Install New Argus
  Server** (refused while agents run; **Install Automatically When Idle**
  applies). It downloads the native app into `~/.argus-server/migrated/`,
  checks it is signed by Argus and is the native build, quits, and a small
  script swaps the apps and opens the new one. The old app is kept as
  `~/.argus-server/migrated/Argus Server (Electron).app`, and the swap is
  logged to `migrated/handoff.log`. If the copy fails, the old app goes back
  and is reopened.
- **By hand.** Quit the old server and put the native `Argus Server.app` in its
  place. If the old one is still running, the native one says so in its menu
  and offers **Take Over from the Old Argus Server**, which asks the old one to
  quit and starts its own host on the same home.
- **Starting at login.** The old server started from a hand-installed launch
  agent (`pnpm server:install-agent`). The first time the native server sees it,
  it asks once whether to start at login with **Open at Login** instead; until
  you agree, the menu offers **Start at Login with This App…**. Agreeing moves
  the old agent to `~/.argus-server/migrated/` and turns on Open at Login.
- **Paired devices in the old format.** The Electron server moves its paired
  devices and MCP sign-ins to the keychain format the native host reads the
  first time a recent version runs. If the native server finds them still in
  the old format, its menu says so: open the old server once, then come back.

Going back is the reverse: quit the native server, put the old app back (it is
in `migrated/`), and reinstall its launch agent with `pnpm
server:install-agent`. Both use the same home and the same lock.

## Electron server (deprecated)

The Electron build (`pnpm build:app:server`, `pnpm dev:server`,
`scripts/electron-builder-server.config.cjs`) still builds, so the last
release that hands over to the native app can ship. It is removed one release
after that. Until then:

- `pnpm dev:server` runs it unpackaged on `~/.argus-server-dev` and port 47617,
  with dev-loopback pairing on.
- `pnpm server:install-agent` installs its launch agent and prints a
  deprecation note; the native server replaces the agent as described above.
- Its menu offers only the hand-off as an update: Squirrel.Mac would refuse the
  desktop's update feed on a server, since the bundle ids differ.
- When the native server already runs on its home, it quits at launch with a
  log line instead of competing for it.
