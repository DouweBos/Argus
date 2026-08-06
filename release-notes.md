
### Minor Changes

- 708322f: Device UI inspection is now Apple-only and reads the running app in-process for
  much richer detail — real class names, resolved colors and fonts, text, and the
  full view/layer tree — instead of the accessibility-only snapshot. The Inspect
  mode only appears for iOS/iPadOS/tvOS runtimes. If the app isn't set up for
  inspection, Inspect now offers one click to restart the running app with it
  enabled, or — on the home screen — a picker to launch any installed app with
  inspection. Selecting an element lets you live-edit its text, colors, alpha,
  visibility, corner radius, and border right on the device. Adds a ColorSwatch
  component to the design system.
- 042d55c: Removed the embedded file editor panel. ⌘-clicking a file link now opens the file in your default app.
- bc1f694: Slash commands now show an inline argument hint in the message input once you pick a command, so you know what to type next.

### Patch Changes

- f1126d7: Anchored dropdowns (run commands, runtime picker, runtime links) no longer close when unrelated parts of the app scroll, such as the agent chat auto-scrolling on a new message.
- 655983f: Fix a crash ("Cannot read properties of undefined (reading 'matchAll')") that could take down the whole chat view when a message or tool-call block had no text.
- 1dc015c: Fix `get_agent_result` refusing to return a finished agent's result when the agent had completed its turn but its process was still alive (status "idle").
- d9f1fac: Background Explore/Plan subagents no longer stall on permission prompts that never appeared, and their final results now show up in the conversation even when they finish many turns later.
- b4f5811: The running spinner on a sub-agent tool call now shows on the left where the status dot sits, instead of beside the agent name.
- Updated dependencies [f1126d7]
- Updated dependencies [708322f]
  - @argus/peacock@0.12.0

