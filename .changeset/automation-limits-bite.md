---
"argus": patch
---

Automations now stop at their autonomy level in the terminal too: a session an
automation started cannot push a branch or open a pull request from the shell
unless the automation is allowed to. Cost limits are enforced — a run that
reaches its ceiling is stopped, and runs are skipped once the day's budget is
spent. A session holds its concurrency slot until it is merged or deleted, and
an automation can only touch sessions it created itself.
