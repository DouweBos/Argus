
### Minor Changes

- 38861a2: Added a public documentation manifest in the Argus repo, plus three new user-facing docs (Getting started, Concepts, Features). These power a proper multi-page documentation site at houwert.dev/argus/docs covering everything Argus supports.
- e698cb4: Test MCP server connectivity right from Settings — every entry in the project, app-level, and inherited MCP lists now has a Test button that runs a JSON-RPC initialize handshake and reports latency or the failure reason.
- 73ce2ab: `.argus.json` now supports a `min_argus_version` field. When set, the project home screen shows a warning if the running Argus app is older than the required version.
- e73924e: When generating `.argus.json` during onboarding, Argus now shows a spinner while Claude is thinking and presents the proposed config for review before writing the file — discard or save instead of an automatic write.
- 73ce2ab: Run commands can now declare a `requires` list of other run-command titles that must already be running in the same session — handy when a frontend dev server needs the backend up first.
- e29f4d6: Run commands now print an explicit "exited" status line in the terminal when they finish, and active run-command tabs show a spinner icon while still running.
- 6c45b66: The macOS menu bar dropdown now nests projects, sessions, and agents in three layers, and clicking an agent jumps directly to that agent — even when you are already viewing the same session.

### Patch Changes

- 9d42389: Telemetry docs now note that the PostHog project has "Discard client IP data" enabled — the raw IP is not stored alongside events, though PostHog still uses it at ingestion to derive city-level GeoIP fields before discarding it.
- d892670: Linked project directories now appear as folder chips inside your sent message instead of a wall of bracket text.
- 4140d5a: Fix the floating simulator window opening blank.
- 119221b: Fix anonymous telemetry in production builds. Main-process events were being silently dropped because the PostHog key was only inlined into the renderer bundle.
- 631483b: Corrected the telemetry documentation to be fully honest. When telemetry is opted in, Argus now clearly discloses every property attached to events — including the standard PostHog SDK auto-properties (browser, OS, screen, timezone, in-app URL, session id) and the city-level GeoIP that PostHog derives server-side from the request IP. Previous docs incorrectly claimed "anonymous distinct id only" and "no IP address or geolocation"; that is fixed. No code change to what's collected — only the docs.
- f765db8: Session and chat title generation is now reliable and fast: it no longer loads the project's CLAUDE.md, MCP servers, hooks, or skills, so titles arrive in seconds instead of timing out and falling back to a slug.
- fba698b: Trimmed the public-facing docs to drop implementation details that don't help users — code-signing/notarisation specifics, internal source paths, library names, and contributor-only sections — while keeping every user-facing setting, the full feature catalogue, and the complete telemetry/privacy disclosure.

