---
"argus": patch
---

Fix sessions getting permanently stuck on "initializing" when the setup terminal is closed or a setup command crashes before finishing. The session now fails cleanly so it can be retried or removed.
