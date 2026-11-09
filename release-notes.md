
### Minor Changes

- 2b9047d: Starting an agent on iPhone and iPad works like the Mac: a `+` in a session's agent tabs opens a New agent tab with the composer in place, empty sessions show the composer straight away, and Home has a New Session button.
- d0e93e0: The web client is no longer served to browsers on your local network unless you turn on "Serve the web client on this network" in Remote Access settings, since that page travels unencrypted. The tunnel and Tailscale addresses keep serving it as before.
- 94746e7: Agents can now stop a dev server or other run they started, the same way Ctrl-C would, and the Stop button now reliably shuts down wrapped commands like `pnpm` → `turbo` → `vite` without leaving stray processes behind.
- db81540: The first time you turn on remote access, Argus for Mac explains what it opens up and asks you to confirm.
- 2114ce3: A session with an open pull request links to it in place of the "Merge into" button, on the Mac and on iPhone.
- 6a148c3: Hovering the sidebar's Usage button shows each account's current session limit, and hovering a project shows its path, branch, git state and how many sessions are working.

### Patch Changes

- 3a3067a: A new session whose worktree couldn't be created now shows as failed with the reason, instead of setting up forever.
- a1f8ece: Deleting or moving a session, or removing a project, now frees the memory its agents' conversations held.
- 5e5991a: Argus for Mac gives its background host more memory, so it is far less likely to crash and stop running agents after days of uptime.
- 479300e: Fixes a memory leak that made the Argus host crash after a few days of uptime: each warm or stopped agent left its tool connection open.
- b93948e: Opening an agent on iPhone or iPad shows that agent, rather than another one from its session.
- 7b6d04a: Runner log lines no longer show up as messages in the agent chat; they only appear when the agent crashes.
- b5e2153: Remote connections now ignore malformed messages from a host instead of failing on them.
- 6655b53: Remote access holds up better against floods of connection attempts.
- a1d22ce: Remote access no longer starts on a computer that can't encrypt its pairing keys, and an older unencrypted key file is encrypted the next time Argus starts.
- ee6bc6d: Remote access refuses browser connections from web pages other than the Argus web client.
- 855b0be: Remote access no longer opens a duplicate connection when a device sends its handshake twice.
- 9857d3c: Updates bundled libraries to versions with known security issues fixed.
- 0305c31: The iPhone app no longer shows "Couldn't reach this computer" after it has connected.
- 623926d: When Argus is stopped abruptly, its remote access tunnel now stops with it instead of being left running in the background.
- 5441ca5: A Cloudflare tunnel set up in an earlier version no longer exposes its connector token to other users on the same computer.
- 7965637: The web client now shows Mermaid diagrams as images, so nothing inside a diagram can run code in the page.

