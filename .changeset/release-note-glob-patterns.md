---
"argus": minor
---

The session home screen now drives its release-notes list from a single `release_note_patterns` config in `.argus.json`. Each pattern has a `format` of `changesets`, `regex`, `json`, `yaml`, or `xml` — letting projects pick how their release notes are written and which fields show as Badges. Existing `@changesets/cli` projects keep working with no migration: when the config is empty but `.changeset/` is present, Argus auto-uses the changesets format.
