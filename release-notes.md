
### Minor Changes

- 8f47226: Sign in to OAuth-protected MCP servers (Figma, Linear, etc.) directly from Argus. A failed connectivity test now shows a "Sign in with browser" button when the server returns 401, walks through the OAuth 2.1 flow, and stores the resulting token securely in your OS keychain. Spawned agents inherit the bearer transparently.
- 4cedbbc: The session home screen now drives its release-notes list from a single `release_note_patterns` config in `.argus.json`. Each pattern has a `format` of `changesets`, `regex`, `json`, `yaml`, or `xml` — letting projects pick how their release notes are written and which fields show as Badges. Existing `@changesets/cli` projects keep working with no migration: when the config is empty but `.changeset/` is present, Argus auto-uses the changesets format.
- 085d0e0: Reorder run commands in Project settings with up/down arrows on each entry. The order is reflected in the run menu.

### Patch Changes

- 627d9c6: Deleting a session that failed to create its worktree no longer errors out. Argus now cleans up the leftover state instead of refusing the delete with a git "is not a working tree" message.
- 5e1a92c: The onboarding preflight check now uses a two-column grid of cards, each with install instructions or a link when something is missing. The progress indicator no longer bleeds through scrolled content.

