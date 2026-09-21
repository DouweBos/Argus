
### Minor Changes

- 17ac97d: Show iOS simulators the right way up: the device view now follows the device's orientation, and follows a foldable to whichever screen is lit. Adds Rotate and Fold buttons to the device toolbar.
- 4daf453: New built-in automation: Local branch cleanup. Weekly, it finds the local branches whose pull request already merged and whose remote is gone, and proposes each one for deletion with the exact command to run. Off by default, like every built-in.
- 51d87de: The phone gets an inbox: read what your automations are proposing, start the work, or dismiss it with a reason. Starting one needs the control grant, same as sending an agent a message.
- 13f2c16: Home now shows what needs you: pending proposals you can start or dismiss without leaving the screen, plus automation runs that failed, with a link to the rest of the inbox.
- 66901e6: Inbox proposals now carry their own call to action. An automation that finds a PR needing a reviewer asks you to open it instead of offering to start a session with no code to write, and a proposal with nothing to act on shows only Dismiss.
- 67363d7: Home now highlights automation reports you haven't read yet and lists them first, with a count next to "Recent runs". Run history and the sidebar flag them too. Opening a report clears it, and a fresh report from the same automation retires the one before it.

### Patch Changes

- 9c79242: Rows built on a full-width button — inbox items, list pickers, tree rows — now line their content up on the left instead of floating it in the middle.
- b1600ee: Sharing an agent now tells you what's missing before you start, and explains any failure with the reason and the steps out of it instead of a raw error. A missing `cloudflared` comes with the install command ready to copy, and a half-set-up Tailscale points at the checks that fix it.
- 66901e6: Inbox rows now line up on the left instead of floating in the middle of the row.
- 17ac97d: Fix the Home button and keyboard input doing nothing on iOS simulators.
- 51d87de: The phone marks an automation report read when you open it, and dots the ones still waiting — the same unread state your Mac shows.
- Updated dependencies [b1600ee]
  - @argus/peacock@0.14.0

