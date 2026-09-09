
### Minor Changes

- 84703d5: Update the bundled conductor CLI to v0.31.0.
- 64f38e0: Manage a project's branches from the phone: a new Branches screen switches, creates, and deletes branches, offering to stash or discard when uncommitted changes block a switch and confirming before dropping unmerged commits.

### Patch Changes

- 5d18ded: Redesigned the lock screen in the mobile app with a watching-eye mark and a Face ID / Touch ID unlock button.
- b8806bb: The mobile image viewer now supports pinch and double-tap zoom, panning while zoomed, and swipe-down to dismiss.
- 28d3f36: Messages sent with linked projects from the phone now show project chips instead of the raw linking text.
- d814c20: Links in mobile transcripts are now tappable inside bold text and headings, keep trailing punctuation out of the URL, and no longer look like links when they point at something the phone can't open.
- 9ff6b00: The mobile agent screen's stop button is now labelled "Shut down agent", and its confirmation no longer claims the agent is mid-turn when it's idle.
- 5d18ded: Image attachments in chat messages now have a subtle outline so they stand out from the background.
- f7f9395: Recent agents on the phone now list the ones needing input or still running before idle and finished ones.
- 741ed1a: Agents waiting on you now stand out in the phone and browser clients: rows blocked on a permission prompt, a question, or a plan approval are badged and sorted to the top instead of looking idle.
- 43f5a5d: Fix worktrees getting stuck on "initializing" after a setup command like `pod install` finished successfully. Setup commands now run in a shell whose line editor can't garble them, and a setup command that goes silent for 20 minutes fails with an error instead of hanging forever.
- Updated dependencies [5d18ded]
- Updated dependencies [43edb2d]
  - @argus/peacock@0.12.3

