---
"argus": patch
---

Terminals no longer fail to open when `$SHELL` points at a shell that is not installed on this machine. Argus falls back to `/bin/sh` and says so, instead of failing with an unexplained spawn error.
