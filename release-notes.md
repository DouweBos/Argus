
### Minor Changes

- fe43325: The Project settings dialog now has a Personal section where you can set your branch prefix. The value is stored locally on your machine, not in `.argus.json`, so it stays personal and is not shared with the team.
- 2e0e61d: Marking a session as ready after a setup failure now also kicks off the agent with the original prompt, matching what would have happened on a successful setup.

### Patch Changes

- a395352: The play icon shown on a session with an active run command now properly turns green, and continues to indicate when an agent is also running.
- 3652a97: Required run commands now appear as their own terminal tab when auto-started, so dependencies like a Metro bundler are visible and capture output instead of running invisibly in the background.
- b795e5b: The Changes preview in the toolbar now wraps long diff lines instead of truncating them with an ellipsis, so you can read the full content of every change.
- e0f8f29: The "Check for Updates…" item in the Argus application menu now actually shows the refresh icon — previous builds rendered a blank square next to the label.
- 93f6dc9: The project header in the sidebar now shows a pulsing play icon while its run command is executing, matching the running indicator already shown on individual sessions.
- b4db57a: The Apple TV remote now stays vertically centered next to the simulator stream in the docked runtime view, and pins to the top of the enlarged dialog so it no longer stretches awkwardly.

