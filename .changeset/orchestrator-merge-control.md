---
"argus": minor
---

Give orchestrator agents the tools to drive a child session's lifecycle through merge conflicts and out the other side. New MCP tools: `merge_status` for a comprehensive ahead/behind/conflicts/in-progress report, `attempt_merge` for a resumable merge that pauses the worktree on conflict instead of aborting, `continue_merge` to finish the merge after the orchestrator wrote resolutions, `abort_merge` to roll back, `write_session_file` to land conflict resolutions (with `stage: true` so `continue_merge` picks them up), and `complete_session` for the happy-path "merge into base + delete the worktree" combo.
