---
"argus": patch
---

Fixes a memory leak that made the Argus host crash after a few days of uptime: each warm or stopped agent left its tool connection open.
