
### Patch Changes

- e1be735: Give each Claude account its own CLI identity so agents stop failing with "OAuth session expired and could not be refreshed" after switching accounts. Accounts whose credentials stop working now show as Signed out in Settings with a Sign in again button.
- 38d7e3e: Fix custom runners being ignored: the runner picked in the new-session dialog (and the default runner set in Settings) is now actually used for the session, and switching runners resets the model to that runner's own default.
- Updated dependencies [e1be735]
  - @argus/peacock@0.12.1

