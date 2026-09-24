
### Minor Changes

- 4a1402a: Pick a runner per agent instead of per session. Each new agent starts on the session's runner and can be switched until you send its first message, so one tab can run on a custom gateway while its siblings stay on Claude Code. The picker also stops claiming a switch that the app refused.

### Patch Changes

- effbe9a: The Apex runner preset now exposes a context-window field, so auto-compact can use the gateway's real limit instead of assuming 200k.
- bc535cd: CLI diagnostics like an unrecognized model id now read as warnings in the transcript, with their details spelled out instead of dumped as raw JSON. They were styled as errors, which made a harmless notice look like the run had failed.
- 864d296: Fixed a connected Mac showing no projects: its repositories were being registered against your own machine instead of the one they live on. Closing a project from a remote tab no longer closes your local copy of it either.
- 5d07388: Resuming a conversation, reopening a closed tab, or forking a chat now stays on the runner that produced it instead of falling back to the session's default.
- 864d296: The warnings and errors badge now opens the notifications screen when clicked from Home, instead of doing nothing.
- Updated dependencies [bc535cd]
  - @argus/peacock@0.19.0

