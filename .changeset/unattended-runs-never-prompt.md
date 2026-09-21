---
"argus": patch
---

Automation runs no longer stop to ask for permission. A read-only run used to sit waiting on a prompt nobody was there to answer and time out after 20 minutes; it now runs to completion. Read-only runs still cannot change anything — writes are refused whether the run reaches for an edit tool or a shell command.
