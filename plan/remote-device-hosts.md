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

### EAS Simulator hosts (`services/deviceHosts/eas/`)

Cloud simulators from Expo's EAS Simulator; the reference was T3 Code's
`EasDeviceHost` (MIT), rewritten as plain TS.

- **Config**: `easHosts` in `device-hosts.json`, apart from `hosts` so a
  reader that predates it still parses the file (`writeDeviceHostsFile`
  keeps the other key). Ids `eh` + 8 hex. Limits as T3/EAS: session 1–115
  (30), idle 1–60 (10) and below session, concurrent 1–20 (2). Optional
  `appId`; without one the account's only project is used.
- **Credential** (`credential.ts`): saved token (sealed with
  `HostPlatform.secretStorage` in `eas-tokens.json`, refused without OS-backed
  storage), then `EXPO_TOKEN`, then `~/.expo/state.json`'s `sessionSecret`
  (`expo-session` header). Every error goes through `scrub`; account-check
  errors reach clients only as categories.
- **Expo API** (`expoApi.ts`): eas-cli's GraphQL operations over `fetch`.
  `rejected` follows eas-cli's rule (4xx, or USER errors with null data);
  anything else may have run, so a failed create counts as uncertain.
- **Devices are slots** (`host.ts`): `eas:<hostId>:<n>`. `list` = running and
  starting slots + the next free one while under the limit; `open` starts a
  billed session in that slot and waits (minutes) until serve-sim answers;
  `close` stops it. Starting slots read "EAS Simulator · starting".
- **Billing safety**: every create carries run/idle limits; the limit counts
  running + starting + failed-stop (`unresolved`) + unknown-outcome creates
  (`uncertain`). The session's unique name is written to
  `eas-sessions/<hostId>.json` before the create; leftovers are found by
  name via the app's active sessions and stopped at boot
  (`initEasDeviceHosts`), every minute while listing, on removal and at
  shutdown (bounded to 8 s in `terminateHostProcesses`). Sessions not in the
  ledger are never touched. A removed host whose stops failed keeps its
  ledger and token until a later sweep empties it.
- **Video** (`serveSim.ts`): AVCC (`/helper/<udid>/stream.avcc`) first; on
  409 `stream_transport_locked` the host terminates WebRTC itself with werift
  (`simulator/webrtcVideo.ts`, pure TS) — one non-trickled offer with every
  candidate, ICE servers from serve-sim's `/api` — and depacketizes H.264 RTP
  (`h264Rtp.ts`: single NAL, STAP-A, FU-A, drop-to-keyframe on loss, PLI until
  the first IDR). Both feed `AccessUnitWriter`, so clients see the same access
  units as any source and the session token never leaves the host.
- **Input**: serve-sim's tagged-JSON WebSocket (`/helper/ws`, token as
  `serve-sim.token.<t>` subprotocol): touch 0x03, button 0x04
  (home/lock/app_switcher), key 0x06; admitted 0x83, screen config 0x82.
  Primed with one MJPEG request first.
- **Capabilities**: all off (no simctl/conductor). Display info from the
  stream's coded size; rotation from serve-sim's screen config (its stream is
  the raw framebuffer, so a sideways UI arrives sideways and clients turn it
  upright and send raw-space touches, as serve-sim expects).
- **Phone**: `device_hosts.list` adds `kind`, `running_sessions`,
  `max_sessions`. `device_hosts.start_eas_session` (control, guest-denied)
  returns the slot id at once and starts in the background;
  `device_hosts.stop_eas_session` (control). `devices.watch` (monitor) refuses
  an EAS id that isn't running, so watching never starts a billed session.

Not done: rotating the device through serve-sim's 0x07, Android sessions,
MJPEG fallback, agent-device access, restoring a missing SPS VUI (T3 does it
for Chromium's hardware decoder).
