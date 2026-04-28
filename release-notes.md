
### Minor Changes

- cb18792: You can now add your own MCP servers from Settings (personal, machine-local) or from a project's `.argus.json` (shared with the team). They are merged with the MCP servers Argus already inherits from Claude Code, so every agent gets the full set.
- 988c5db: Add anonymous usage and crash reporting via PostHog. Argus only sees which features are used and what errors occur — never your prompts, file contents, project names, or any identifying information. New installs now choose during onboarding whether to share data; the default is off until you opt in. A "?" button at the bottom of the tool rail (always visible) opens an anonymous feedback dialog. Flip the choice any time under Settings → Privacy. Disabled in development builds.
- 09ea14c: Starting an agent or plan-mode agent now opens a full-featured prompt dialog (model picker, project linking, slash commands, file mentions, image attachments) instead of an empty tab. The new-session dialog gained the same model and project-linking controls, both forwarded to the first agent that boots in the session. New sessions are focused immediately while setup runs in the background. The in-chat TODO list shows a spinner on the in-progress item, and AskUserQuestion prompts include a free-form text field alongside the options. A new "Display size" setting in Appearance scales the whole UI between five presets (Larger Text → More Space), with a slightly larger default than before.

### Patch Changes

- bb1fecf: The Agents overview now shows session names instead of short ids, and the project link opens the project's home instead of the project picker.
- 0d459db: When an update finishes downloading, the changelog dialog now opens automatically so you see what's new alongside the restart prompt. The changelog dialog itself also has more breathing room around its content.
- 87b2808: Soften the dark theme: backgrounds are lifted from near-black to a slightly lighter slate, and primary text is dimmed from pure white to an easier-on-the-eyes off-white.
- 4423e48: Fix ⌘-clicking a file link in production builds — the editor view now reliably opens the linked file instead of switching to the editor without loading it.
- 723c261: Chat titles now generate reliably instead of failing with a "prompt too long" error.
- 14adf71: The zoom toolbar in the image viewer is now readable in light mode.
- dd01d68: Agents now keep their selected model when restarting or restoring an earlier turn, so 1M-context sessions no longer silently revert to the 200K default.
- c9e7808: Rebasing a session onto its base now auto-commits any staged changes first, so the rebase no longer fails with "Your index contains uncommitted changes."
- 7624fd2: Terminal tabs and the running indicator for run commands are now restored after reloading the Argus window, so dev servers and other long-running processes stay visible instead of becoming orphaned.
- 735f728: Fix single-runtime mode racing against the previous runtime — when stopping another session's run to start one here, Argus now waits for the old process to actually exit before spawning the new one, so dev servers no longer fail with "port already in use".
- 0bf3bbe: Right-clicking a misspelled word in chat inputs now shows spelling suggestions and an Add to Dictionary option instead of just the basic edit menu.
- 1a850f5: The notifications button now stays visible in the tool rail on the home screen, so background warnings and errors are always one click away even when no session is selected.
- Updated dependencies [87b2808]
- Updated dependencies [988c5db]
- Updated dependencies [98e243c]
  - @argus/peacock@0.6.0

