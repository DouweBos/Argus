
### Minor Changes

- 6518f06: While you're sharing a device, the simulator now says who is driving it — and warns you when a guest is tapping at it and being refused because someone else holds it. The huddle's People list marks them too, so a guest stuck on a screen that won't answer is no longer invisible to everyone but themselves.
- 6518f06: Sharing an agent now hands you a ready-to-paste invitation — "Ana wants you to join “Fix the login flow” in Argus — <link>" — instead of a bare URL, so whoever gets it knows who sent it and what it opens. The link on its own is still one click away, and you can set the name it uses under Settings → Remote access.
- 6518f06: Huddles now have a chat for the people in them, so you can ask "which build is this?" without going back to Slack. Open it from the Chat button beside Share, or the chat tab if you joined by link — it shows a count of anything said while you were looking elsewhere. The agent never sees these messages, and they go when the huddle ends.
- 6518f06: Huddles now show who is typing. Guests see each other and you — by name — above the message box, and your People list marks anyone mid-sentence, so nobody sends the same thing twice.
- 6518f06: Unread automation reports now show up in the Inbox under "New reports", and the unread dot moved from Automations to the Inbox.
- 6518f06: The pairing confirm screen now says what is asking to pair — "Argus Remote on iPhone 17 Pro", "Argus Web on iPad", "Argus for Mac" — and only offers the second-keyboard grant to another Mac, since a phone or a browser could do nothing with it.
- 6518f06: Plan approvals now offer "Approve in new session" — it opens the new session dialog pre-filled with the plan so the current session can keep working.
- 6518f06: Cleanup proposals now come with the button that carries them out — delete the branch, retire the worktree — behind a confirm that names exactly what goes. Branch janitor uses it: it now proves whether a branch's work already landed (patch-id equivalence, a merged or closed PR, the ticket) and only proposes the deletions it can back up, leaving everything it is unsure about in the report instead of the inbox.
- 6518f06: The remote app can now rotate a simulator and fold an iPhone Duo, and presents the stream the right way up when the device is on its side.
- 6518f06: The remote web client now uses the full screen on an iPad or a desktop browser: your projects and sessions stay in a resizable sidebar beside whatever agent, device or diff you have open. Phones keep the single-column layout.

  Touch handling got a pass too — pinch-zoom works again, the composer stays above the keyboard, the layout clears the notch in landscape, and hover styles no longer stick after a tap. With a hardware keyboard, Cmd+[ and Cmd+] move back and forward, Cmd+\ toggles the sidebar, Cmd+K jumps to the composer and Cmd+/ lists the lot.

  The remote client's model, mode and project pickers, its slash-command list and its @-mention picker now look and behave exactly like the desktop's, and its session cards pick up the desktop styling.

- 6518f06: Apple TV and Android TV devices get a proper on-screen remote in the remote app, and a connected hardware keyboard's arrow keys and Return drive the d-pad.
- 6518f06: An automation's spend ceiling is now editable in its own settings and ships off, for built-in templates as much as for your own. Nothing caps what a run may cost until you say so, and the $5 ceiling older automations were given without asking is cleared on upgrade.
- 6518f06: Morning triage now counts what you already have in flight — open PRs, running sessions, proposals still waiting — and reaches further down its list to top you back up to about four. A quiet morning gets you real work to pick up instead of a reminder to merge something.
- 6518f06: In the web client, Enter now sends (or queues) your message and Shift+Enter starts a new line, matching the desktop app. On a phone, where there's no Shift to reach a new line with, Enter still breaks the line and the send button sends.

### Patch Changes

- 6518f06: Dialogs now share one consistent layout. The automation, device and source-control dialogs no longer run their content against the edge of the window, and every dialog's fields line up with its title.
- 6518f06: Your own messages and queued messages now carry your name while an agent is shared, so guests can tell your messages from each other's instead of seeing unattributed ones.
- 6518f06: Picking a shut-down iOS simulator now boots it automatically instead of sitting on "Connecting to device…" — Xcode 26 and later removed Simulator.app, which used to boot the device as a side effect.

  Folding or unfolding an iPhone Duo no longer leaves the device screen black; the stream now follows the panel switch.

- Updated dependencies [6518f06]
- Updated dependencies [6518f06]
- Updated dependencies [6518f06]
- Updated dependencies [6518f06]
- Updated dependencies [6518f06]
  - @argus/peacock@0.16.0

