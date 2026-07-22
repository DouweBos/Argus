
### Minor Changes

- 7d3f24d: Android emulator mirroring is now much faster to start and more responsive. Emulators stream over the emulator's native interface instead of scrcpy, so there's no server push on connect and taps and keystrokes land with less delay. Physical devices continue to use scrcpy.
- eaeea3f: Mermaid diagrams in chat now have a toggle to switch between the rendered diagram and its raw source, plus a copy button so you can paste the diagram into other docs.
- eaeea3f: Adds secure remote access: pair a phone or a browser on your network and monitor your projects and agents from anywhere, and approve or deny agent permission prompts remotely. Argus exposes a local, end-to-end-encrypted gateway through a Cloudflare or Tailscale tunnel — or, on your own Wi-Fi, serves a web client directly with no tunnel at all. There are no inbound ports, and paired devices monitor and approve prompts by default. Set it up under Settings → Remote Access, or the Remote access button on Home.
- eaeea3f: Remote devices you grant control can now drive agents like the desktop — send messages and images, interrupt, switch model, permission mode, and reasoning effort, use slash commands and @-mentions, start new agents, and create new sessions. Control is opt-in per device (toggle it when pairing or later under Settings → Remote Access); other devices stay monitor-only, and creating projects always stays on this machine.
- eaeea3f: The remote web client can now view and control connected simulators and emulators from your phone: browse booted devices, watch their live screen, and tap, swipe, type, and press hardware buttons. Screen control requires a device paired with control access.
- eaeea3f: Remote web client: control devices can now stop agents and rename or delete sessions and branches, and any paired device can review a session's git status and the diff of what an agent changed (branch or working-tree) right from the browser.
- eaeea3f: The remote web client now shows notifications when an agent finishes, needs approval, or sends a push — the same alerts you get on the desktop. Enable them from the web client's Settings screen.
- 0091b4a: An agent that has delegated to a Claude subagent (Task/Agent tool) now keeps showing as running while that subagent works, instead of appearing idle. You can still send it a new message in the meantime.
- 7d3f24d: Connected capture cards and cameras now show up as devices you can watch live. Pick one from the runtime target picker's new Video Inputs section, or open it from the Devices list, to see its picture. It's view-only.
- eaeea3f: The remote web client now mirrors the desktop chat faithfully: markdown, per-tool rich rendering, edit/write diffs, embedded images the agent read, nested sub-agent activity, and task/todo lists — all read-only. The chat presentation layer is now shared design-system components, so the desktop and web views stay in sync.
- eaeea3f: The remote-control web client now shows the context-window usage meter next to the model, matching the desktop, so you can see how full the agent's context is from your phone.
- eaeea3f: Permission prompts in the remote web client now render inline in the transcript, exactly like the desktop — including the interactive AskUserQuestion form and plan approval — instead of a separate raw prompt card at the top. You can pick answers, send plan feedback, or allow/deny right where the tool call appears.
  </content>
- eaeea3f: You can now queue messages to a busy agent from the remote-control web client — type while it's working and the message is held, then sent automatically once the agent goes idle. Queued messages show in the transcript and can be removed before they send.
- eaeea3f: The remote web client gains a settings screen where you can name the device, switch between light, dark, or system appearance, and unpair. The chosen name now shows in Argus under paired devices, and a device that's currently connected shows a live "connected" indicator there instead of always reading "never connected".
  </content>
- eaeea3f: The remote web client now matches the desktop app's look: the top nav bar, projects list, and agents list all use the shared design-system components — colored project folders, section headers, and status-dotted agent rows — instead of the previous plain cards.
  </content>
  </invoke>

### Patch Changes

- 182db2c: Signing in to your Claude account now finishes automatically once you approve access in the browser — no need to copy a code back, and the Settings panel updates on its own.
- 4b145ae: A failed Mermaid diagram no longer leaves a stray "Syntax error" graphic at the bottom of the app that pushed the whole layout up.
- eaeea3f: Harden remote control security: approving an agent's tool prompts now requires granting a device the "control" role (not just "monitor"), remote devices can no longer switch agents into unattended bypass-permissions mode, and remote file browsing and session access stay confined to your registered projects. Also caps unauthenticated connections and pins the diagram renderer's sanitizer.
- 86e10d1: Approving a plan now returns the agent to the permission mode it had before entering plan mode instead of dropping to "Ask".
- eaeea3f: Session cards now share one design-system component across the desktop sidebar and the remote web client, so both render the same icon, badges, and diff stats. The remote web session list picks up the desktop's colors and styling instead of its previous grey, hand-rolled look.
- ba73057: Updated conductor to 0.22.0.
- Updated dependencies [eaeea3f]
- Updated dependencies [7d3f24d]
- Updated dependencies [eaeea3f]
- Updated dependencies [eaeea3f]
- Updated dependencies [eaeea3f]
  - @argus/peacock@0.10.0

