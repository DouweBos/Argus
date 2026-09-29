
### Minor Changes

- 549741c: Automation runs can now read GitHub CI logs, artifact lists and the contents of test artifacts, including read-only runs.

### Patch Changes

- 4f7dfbd: Read-only automation runs can now withdraw their own proposals once the branch, PR or issue behind them is gone.
- e5419f6: The inbox no longer lists started work under "Argus is on it" once its session has been merged or deleted.
- c723676: Text fields in the iOS app now offer autocorrect, predictive text and capitalization for written input like plan feedback and messages, while branch names, codes and paths stay verbatim.
- 5c981f1: Handing a plan off to a new session from the iOS app now starts the agent on your computer, even if the phone is locked or the app is closed while the session sets up.
- fcd6564: An account marked Limit reached is re-checked in the background, so the badge clears once its quota resets instead of lingering until an agent runs on it.

