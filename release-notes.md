
### Minor Changes

- 195d16e: Run commands now auto-start their dependencies. When you start a run command whose "Requires running" list includes another command that isn't up, Argus launches the dependency (and its dependencies) first instead of refusing to start.

### Patch Changes

- 1f2377c: Recover a session whose setup command failed without restarting the app. The session home screen now shows a "Mark as ready" button next to the failure, so you can run the failed step yourself in the terminal and then unblock starting agents.
- 6db1885: Fix renderer telemetry events (including the in-app feedback dialog) not reaching PostHog in production builds. Renderer events are now routed through the main process instead of going direct from the file:// origin.
- 9e411e3: Run command entries in the project setup dialog are now visually grouped into cards, so it's easier to tell where one command's settings end and the next begins.
- 25bff55: Apple TV remote keyboard shortcuts no longer hijack the spacebar, arrow keys, and Enter while you are typing in the terminal or another editable area when a tvOS simulator is open.

