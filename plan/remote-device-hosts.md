# Remote device hosts (SSH)

Show and drive iOS simulators that run on another Mac, reached over SSH, as if
they were local.

## Shape

- **Config** lives with the machine running the host (it owns the SSH config
  and keys): `$ARGUS_HOME/device-hosts.json`. Each host: generated `id`
  (`rh` + 8 hex), `target` (ssh alias or `user@host`), optional `port`,
  `identityFile`, `label`. Validated before it is saved or used.
- **Device ids** are namespaced: `<hostId>~<udid>`. Local ids stay bare UDIDs,
  so nothing changes for local devices, and every existing command, event
  channel, claim and route keeps working on an opaque id.
- **`DeviceMachine` seam** (`services/deviceHosts/machine.ts`): `exec`,
  `spawn`, `connect(port)`, `toolPath(name)`. `localMachine` is today's
  behaviour; `sshMachine(host)` wraps each call in `ssh`. `ios.ts`,
  `simInput.ts`, `ios-video.ts`, repair and shutdown resolve the machine from
  the device id instead of branching.
- **SSH**: one ControlMaster per host (`ControlPersist`), `BatchMode=yes`,
  `StrictHostKeyChecking=accept-new`, arg arrays only, remote command words
  single-quoted. The H.264 stream comes back over `ssh -W 127.0.0.1:<port>`
  (stdio forwarding) — no local listening port at all. Listing backs off per
  host after failures so polling clients don't hammer an offline Mac.
- **Install**: first capture copies the bundled `argus-sim-bridge` and
  `argus-sim-input` to `~/.argus/remote-bin/<sha12>/` on the remote (pinned by
  content hash). "Test connection" only probes (Darwin, arm64, `simctl`).
- **Removing** a host stops its captures and the ControlMaster; simulators keep
  running.

## Surfaces

- Host commands: `list_device_hosts`, `add_device_host`, `remove_device_host`,
  `test_device_host`.
- Desktop: Settings → Tools → Device hosts. Mac app: Settings → Tools.
- Phone: devices show their host; Settings lists hosts read-only
  (`device_hosts.list`, monitor). Adding/testing from the phone is left out on
  purpose: it would let a paired phone make the host open SSH connections with
  its keys to any target.

## Not in scope

- Android on remote hosts (adb/emulator gRPC/scrcpy all assume local ports).
- Fold/orientation and conductor-driven features (inspector, deep links,
  streaming input) on remote devices — conductor runs locally.
- Agents: the simulator pool and conductor CLI stay local-only.

## Device sources

Above `DeviceMachine` sits `DeviceSource` (`simulator/deviceSource.ts`): what
Argus does with a device, not how it reaches a machine. `list`/`find`,
`open`/`close` (boot/shutdown), `erase`/`delete`, `capabilities(id)`, and
`session(id)` — a `DeviceSession` with `start`, `video` (the shared stream),
`adaptiveVideo` (null when there's no retargetable encode; remote viewers then
ride the shared stream), `input` (touch, named button, HID key), `displayInfo`,
`refreshDisplay`, `stop`.

- `MachineDeviceSource` (`machineSource.ts` + `machineSession.ts`) is the only
  implementation: simctl, argus-sim-bridge, argus-sim-input, for this Mac and
  every SSH host alike. Nothing outside it calls `machineForDevice`.
- `deviceSources.ts` resolves an id to its source through providers. The
  machine provider is the fallback (bare UDID → this Mac, `<hostId>~<udid>` →
  that host); `registerDeviceSourceProvider` puts a new namespace in front.
- Capabilities (`rotation`, `fold`, `conductor`, `settings`, `erase`,
  `delete`, `adaptiveVideo`) replace the old "is it remote" checks in pose,
  conductor and the input-socket lookup. They stay host-internal: no client
  hides controls by them yet.
- Video is access units in (`VideoSink`), not a socket: the bridge's Annex B
  port goes through `readAnnexB`; a source producing frames itself calls the
  sink directly.

### An EAS Simulator source

A provider claiming `eas:<sessionId>` ids. `list` reads the account's
sessions; `open`/`close` create and stop the billed session; `session(id)`
wraps serve-sim — `video.open` feeds WebRTC H.264 access units to the sink,
`adaptiveVideo` null, `input` maps to serve-sim's touch/button/key, display
info from its reported size. `capabilities` all false except whatever
serve-sim supports. `onGone` fires when the account is signed out. Capture
refcounting, the video bus, remote viewers and gating all work unchanged.
