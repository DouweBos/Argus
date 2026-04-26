
### Minor Changes

- c831895: Link any folder to a chat from the project picker, not just Argus projects or git repos. Use the new "Browse for directory…" option to pick an arbitrary directory the agent should be able to read from and edit.

### Patch Changes

- dc61c32: Auto-fetch PR branches from the remote when starting a session, so checking out a PR authored by someone else just works instead of erroring with "branch does not exist".
- 3827101: Fix the updater hitting GitHub directly (and failing with a 404) instead of going through the houwert.dev release proxy. Also show a short, readable message when the feed is unreachable instead of dumping the raw HTTP response and headers into the "What's new" dialog.
- 7d4b122: Hide the Memory tab in the debug panel while it isn't working reliably.
- 3827101: Remove the "Argus on GitHub" and "Report an Issue…" links since the Argus repository isn't public, point "View all releases" at houwert.dev/argus, and move "Check for Updates…" into the Argus application menu (with a download icon) where it belongs.

