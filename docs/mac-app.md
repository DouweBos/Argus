# Argus for Mac (beta)

Argus for Mac is a native SwiftUI app that will replace the Electron desktop
app. It runs the same host core — sessions, worktrees, agents, terminals,
simulators — so your projects and sessions carry over, and it reads and writes
the same `~/.argus`.

It is a beta. The Electron app keeps shipping and stays the recommended
desktop until the Mac app reaches parity; the checklist that gates the switch
lives in the repository (`plan/swiftui-parity.md`).

## What works today

- The three-panel window: projects and their sessions, live from the host.
- Creating and deleting sessions, with setup progress.
- Agents in a session as tabs, with their transcript.
- Banners for agents that finish or need you, with Approve/Deny buttons on
  permission prompts.

Terminals, the runtime panel (simulators, emulators, the browser), the git
views and the settings screens arrive in later betas.

## How it relates to the Electron app

Both apps run the Argus host on the same `~/.argus`, and **only one may run at
a time**: two hosts on the same state would fight over the same worktrees and
agents. Whichever starts first holds the lock (`~/.argus/host.lock`).

- Open Argus for Mac while the Electron app is running and it says so, with a
  button to quit the Electron app and take over.
- Open the Electron app while Argus for Mac is running and it offers the same
  in reverse.

Your phone keeps working with either: the Mac app runs the same remote access
gateway, with the same paired devices.

## Under the hood

The app bundles its own Node runtime and the host
(`Argus.app/Contents/Resources/host/`) and supervises it: it starts the host on
launch, restarts it if it crashes, and stops it — after letting running agents
stop cleanly — when you quit. The host's log is at `~/.argus/logs/host.log`.

The app talks to its host over a Unix socket in `~/.argus` that only your user
can open, rather than over the network.

## Building it

```sh
open clients/argus-ios/ArgusRemote.xcodeproj   # scheme: ArgusDesktop
```

A build phase stages the Node host into the app
(`pnpm build:mac-host --out <dir>`). Debug builds are called **Argus Dev** and
never default to `~/.argus` — they use `~/.argus-mac-dev` unless `ARGUS_HOME`
says otherwise — so a dev build can't collide with the app you use.
