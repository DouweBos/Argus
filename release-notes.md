
### Minor Changes

- fb8b75d: Argus opens a local connection that Argus for Mac can join as a second window, so both apps can show the same projects and agents at once.
- ed8216f: Argus for Mac opens as a second window on the Electron app's Argus when that is already running, instead of asking you to quit it. A toolbar badge shows it's attached, and you can still choose to take over.
- 48c21f4: In Argus for Mac, a session's Home, Agents and Git views switch from a centred control in the toolbar, from the View menu, or with ⌘1, ⌘2 and ⌘3.

### Patch Changes

- 749c716: Long chats stream without slowing the desktop down, and a popped-out or reloaded window shows the whole conversation right away. Older messages load as you scroll up.
- b206d2c: Chats no longer show empty rows or blank tool cards for the agent's internal bookkeeping, such as thinking-only turns and loading deferred tools, and calls cut off when an agent stopped now read "Interrupted".
- 14a6b60: Following a very long conversation from your phone or Argus for Mac no longer slows the desktop down.
- 4ea8b82: Very long agent conversations stay responsive while the agent works, even after scrolling back through older messages or resizing the window.
- 26b177b: Saving a very long conversation while the agent is working no longer stalls the app.
- f015cd6: In Argus for Mac, the chat takes the room a wider window gives and the device panel keeps its width, as in the desktop app.
- 94c52df: The Mac app shows your projects within a second of launching instead of waiting on the Claude account check first.
- b9f64b4: Argus for Mac opens long chats and saved chats faster, and no longer stalls while saving a long conversation.
- d918652: The Mac app no longer flashes "No Claude account authenticated", "No projects yet" or empty agent and device lists while it is still loading them at launch.
- c4c0798: The Mac app no longer stutters while a long conversation is saving or being reopened.
- 274588c: The Mac app stays responsive on very long agent conversations: only the latest messages are drawn, older ones appear as you scroll up, and resizing the window or sidebars no longer freezes it.
- 8db0040: In Argus for Mac, pasting an image or a copied image file into the chat attaches it, and images and files can be dropped anywhere on the conversation, not just on the message field.
- 798f3b4: In Argus for Mac, returning to a session shows the agent you last had open there, and a resumed chat opens straight away.
- 1404514: In Argus for Mac, long chats full of screenshots and tool output open and resize without stalling.
- 51d8e1e: Argus for Mac no longer freezes when you scroll through a long chat; reading back to the first message stays smooth and keeps your place as older messages load.
- 9feed4b: Session setup commands no longer fail now and then when your shell's startup files ask a question, such as oh-my-zsh's "update now?" prompt.
- ba007d0: The browser client follows a running agent's chat as it changes instead of reloading it on every update.

