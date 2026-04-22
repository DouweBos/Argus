---
"argus": minor
---

Projects can now opt into a single-runtime mode (set `single_runtime: true` in `.argus.json`). When pressing Run in a session, Argus warns if another session from the same project already has a runtime going, and offers to stop it before starting the new one.
