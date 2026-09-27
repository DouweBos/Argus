
### Minor Changes

- 7dcafbe: Automations keep memories between runs, so they stop re-learning your codebase every time. You can read, edit and delete them in the automation's settings.
- 11f210d: The iOS app can now change which branch a session merges into, and shows the current one on the "Land this work" card.
- 3b2123f: Tapping a branch in the iOS app now opens it: its history, each commit's diff, a comparison with the checked-out branch, and the same actions as the desktop's branch menu — switch, branch from it, merge, rebase, push, pull, rename, pin, open a PR and delete.
- b360919: Merging a session into its base branch now asks whether to keep every commit or squash them into one — it no longer squashes silently.
- 719f4be: Proposals in the inbox have a View run button that opens the automation run that raised them, so you can read its report or leave feedback without hunting for it — on desktop and on your phone.

### Patch Changes

- 7dede34: The branch menu's rebase item now says which branch gets rebased, Open PR on GitHub opens the right repository, and deleting a branch that isn't fully merged asks before losing its commits.
- 6ac73e5: On iOS, linked-project chips on your own messages now line up with the message on the right.
- 149e9ca: The iOS app now reports anonymous usage and crash data, with the same privacy controls as the desktop app. Pick how much to share on first launch, and change it any time under Settings → Privacy.
- 53b726e: On iPhone, linked projects are cleared after a message is sent, so they no longer carry over to the next one.
- f4c733b: Fixed a merge against a base like `origin/main` collapsing the session's commits before failing. The base is checked first, and a session pointed at a remote-tracking branch is repaired to the local branch behind it.
- f49ca0a: The context meter uses the window size Claude Code reports for the model, so 1M-context models no longer show as 200k.
- Updated dependencies [719f4be]
  - @argus/peacock@0.21.0

