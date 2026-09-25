
### Minor Changes

- 032d203: Rewrite an automation's playbook with Claude from its configuration — describe what should change and review the result before it is saved.
- 361e039: Disagree with an automation report: **Give feedback** on a finished run hands your note back to that run's own agent, which re-checks what it claimed and publishes a corrected report. Feedback only ever adds proposals — the ones already in your inbox stay put unless you switch on "Let it remove proposals".
- 7f26087: Pick which runner a new agent starts on from the iOS app, alongside its model and permission mode.
- c7abc56: Set an automation's time limit from the iOS app, alongside the other guardrails.
- 76f5610: Rewrite an automation's playbook with Claude from the iOS app, the same as on the desktop.
- 1ceb8cf: Stopped agents on iOS are now listed under the session they ran in, instead of one long list at the bottom of the project. Only the ones whose session is gone stay at the bottom.

### Patch Changes

- d04811a: Fix Android emulators showing no video in the iOS and web clients.
- 29866ab: The iOS chat input now offers autocorrect, predictive text and sentence capitals, and collapses back to one line after you send.
- 27ed3be: Editing a queued message on iOS now opens a proper editor instead of an inline field that scrolled away and wouldn't take the keyboard.
- 81fc794: Fixes a message sent from the iOS app jumping ahead of the agent's current turn instead of waiting in the queue.
- 5df89c6: The iOS app now lists every saved conversation a project kept, not just the twenty most recent.
- d1492dc: The Standup digest no longer reports already-merged branches as unshipped — it now checks whether the work is really missing from the base branch before asking you to open a PR.

