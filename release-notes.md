
### Minor Changes

- e7a6060: Hand off between the Mac and the iPhone app: whichever session you have open is offered on the other device, from the lock screen or the Dock.
- fdc48a3: Automations can now be created, edited and deleted from the iPhone app — schedule, projects, signal sources, autonomy, guardrails and the playbook — and paused straight from the automation screen.
- 89d365c: Commit, push and merge a session's branch straight from the iPhone app — the Changes screen now ends the loop instead of sending you back to your computer.
- c851b23: Pull requests reach the iPhone: see the ones waiting on you, read their checks and conversation, comment, merge, and open one for a session's branch straight from Changes.
- 4fb6b36: Run a playbook once from the iPhone with Quick run — nothing is saved behind it — and promote one that proved useful into a real automation from its run.
- d0cd6dc: New sessions on the iPhone can branch off a chosen base branch or adopt an existing one, and a new agent can be started on a specific model and permission mode.
- f2ea401: Morning triage now focuses on finding tickets to work on: it ranks your assigned issues, digs into the unclaimed backlog when those run short, and only raises a review when one is genuinely blocking someone.
- 5fe9005: Keep worktrees somewhere other than your boot disk — set a folder app-wide under Settings → Worktrees, or per project, and Argus offers to move the ones you already have.

### Patch Changes

- 4ae80e8: Automations now skip projects stored on a drive that isn't connected, and say so in the report instead of reporting no work found. A cleanup that would delete a branch or session on a disconnected drive is refused.
- 348ec4e: Fix deleting or renaming a session from the iOS app, which quietly did nothing, and show a message when a request to your computer fails.
- 4dc9354: The iPhone app now takes the interaction claim on a device it opens, says who is driving when someone else has it, and offers to take control instead of silently dropping your taps.
- 9cd21f5: The chat input on iPhone shrinks back to one line as soon as a message is sent, instead of staying tall until you type again.
- 1555f81: Session and project lists on the iPhone now update the moment something changes on your computer, instead of waiting for the next poll.
- e4141b8: Picker sheets on iPhone now respond to a tap anywhere on a row instead of only on the label.
- c2b8dbd: A plan on iPhone can now be handed to a brand-new session with "Approve in new session", leaving the current agent in plan mode.
- bb3a997: Approving a plan on iPhone switches the permission chip out of plan mode right away instead of waiting for the next refresh.
- 52956e4: Report list items in the iOS app now read left-aligned instead of centring when they wrap onto several lines.
- 44378b8: Unlocking your phone now refreshes the chat's queued messages and a project's git summary instead of leaving stale numbers on screen.
- 3b7d017: Session headers on iPhone now show the branch they're on, so the project root no longer hides which branch is checked out.
- 4ae80e8: The iPhone app now shows sessions whose drive isn't connected to your computer, greyed out and naming the drive, instead of offering actions that can't run.
- fd91c7c: Tapping a notification on iPhone now opens the agent it came from, including when the tap launches the app from cold.
- b794fc9: The iOS app can now open a plan full screen from an approval request, with the approve and feedback controls still at hand.
- 5fe9005: Sessions stored on a drive that isn't connected now stay in the sidebar, greyed out, and come back untouched when you plug it in. Previously they disappeared, and the worktrees could be left unusable.
- Updated dependencies [4d2a9a2]
  - @argus/peacock@0.18.1

