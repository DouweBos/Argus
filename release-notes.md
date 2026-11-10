
### Minor Changes

- ca7e4a1: Sessions can run on Gemini CLI, Google Antigravity or Kiro: any agent that speaks the Agent Client Protocol gets chat, tool cards, plans, permission prompts, interrupts, model picking and token usage in Argus.
- 5e1c758: Automations can run once at a date and time you pick, then pause themselves, and a quick run can be set to run later instead of right away.
- c89d28c: Sessions can run on OpenAI's Codex CLI as well as Claude Code: pick Codex as the runner and its chat, tool cards, permission prompts, interrupts, models and token usage all work in Argus.
- 545b459: Sessions can run on the Cursor CLI, signed in with your Cursor account, with its chat, tool cards, permission prompts, plan mode, interrupts and models in Argus.
- d63f305: Leave comments on diff lines in the Git view or on your phone, then send them all to the agent as one review. A new Review button asks a fresh agent to review your changes before you commit.
- ed115ca: Duplicate an automation to get a paused copy you can adapt, for example for another project.
- eb8a174: Select an element in the Browser tab, or a view in the device inspector, and attach it to the chat: the agent gets its selector or view path, styles, bounds and a cropped screenshot.
- c0adae8: Sessions can run on Vercel's fx coding agent, with its chat, tool cards, permission prompts, interrupts and models in Argus.
- 6fbbf27: Sessions can run on xAI's Grok Build, with its chat, tool cards, permission prompts, interrupts and models in Argus.
- 8f8b20b: Projects moving over from Conductor can import their setup and run scripts into `.argus.json`, and Conductor's workspaces and their Claude chats show up as sessions.
- d0ff612: The Mac's start composer gets a Runner pill, so one agent can start on Codex, Gemini CLI or any other runner without changing your default. Picking a runner no longer carries over your default Claude model.
- 8260b86: Sessions can run on OpenCode, with its chat, tool cards, permission prompts, interrupts and models in Argus.
- 2369d1e: Quick Run now picks projects and signal sources the same way the automation editor does, with Select All, and starts from a Run Once button in the toolbar.
- e43d856: Runner pickers show a runner whose CLI isn't installed as unavailable, with how to install it, instead of letting an agent fail to start on it.
- be3c064: Ask a running agent a side question from its composer on the Mac, iPhone and web. It answers from a read-only copy of the agent's context without interrupting its turn or adding to its chat, and you can send an answer into the chat when it matters.
- b12f13a: After merging a session into its base branch, its session card offers to delete the session, on the Mac and the iPhone.
- bf5d0a0: Agents can watch their pull request: Argus checks it every two minutes and wakes the agent when a check fails, the checks pass, the branch conflicts, or someone comments, until the PR merges or closes. Turn it on or off from the session's pull request icon.

### Patch Changes

- 38de93d: Switching sessions while one is pulling, pushing or merging no longer shows the other session as busy too.
- 3209105: The iPhone's Account page now lays out like the Mac's: grouped rows for computers and devices, with requests to join at the top.
- a8a4979: On iPhone, picking projects for an automation or quick run shows folder icons, a count and Select All, as on the Mac.
- 65533c6: On iPhone, an automation shows its track record as the Mac does, and its run history as one list with each run's cost.
- 3e3aa88: The iPhone composer now matches the Mac's: one card with the model, effort and mode as inline menus beside a round send button, and the workspace and branch in a strip tucked underneath.
- 49f7e7f: A computer's page on iPhone and iPad now uses the Mac's grouped settings rows.
- 9baca16: The Devices list on iPhone and iPad shows which devices are running, their runtime, and how many are running in total, as the Mac does.
- ceeffb4: Home on iPhone and iPad shows projects as the same cards as on the Mac, in a grid on wider screens.
- 172a813: On iPhone, a run's figures, report and feedback are laid out as on the Mac.
- 8a04695: A session's details on iPhone and iPad offer Pull, Push and its pull request, as the Mac's context card does.
- 6d04403: A session that is still setting up shows the same progress card on iPhone as on the Mac, and one whose setup failed shows why front and centre.
- a3c91c9: Settings on iPhone and iPad now use the same grouped rows as Settings on the Mac, with a computer's device hosts showing their status at a glance.
- 1f0fe4b: On iPhone, a new session's composer sits centered under its title as on the Mac, and its settings wrap on narrow screens instead of being cut off.
- efaff14: On iPad and unfolded phones, the composer keeps a centered column like the Mac's instead of stretching across the window.
- a9d31fe: ⌘W in the Mac app closes the agent or tab in front again instead of the whole window.
- e232fe8: Opening an automation run's transcript after the run has finished brings its agent back, on the Mac and on the phone, instead of landing on an empty session.
- b41f229: Run history rows line up again: status badges and the Cancel and Delete buttons keep one width, so times, durations and costs form straight columns.

