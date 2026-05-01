
### Minor Changes

- 774b88c: Click an image attachment in the chat input to open it in the preview, then optionally crop it before sending.
- 5321bf3: Optional global session launcher: enable it from onboarding or Settings → Session launcher to summon a floating prompt anywhere with Cmd+Shift+Space (or double-tap right Option on macOS, with Accessibility permission). Pick a project, optionally a session (or run on the project root, or branch off a new one), type a prompt with attachments, drag-screenshot a region, and start an agent without leaving whatever you were doing. Off by default.

### Patch Changes

- 5321bf3: The global session launcher now prompts for macOS Accessibility permission the first time it starts, instead of silently failing until you find the System Settings pane yourself.
- 5321bf3: The first time you drag a region in the global session launcher, the launcher now stays out of the way of macOS's Screen Recording permission prompt instead of popping back on top of it.

