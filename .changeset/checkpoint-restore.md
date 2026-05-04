---
"argus": minor
---

Add chat checkpoints. Each user message now snapshots the worktree before the agent runs, and a "Restore" action on the message reverts files and rewinds the chat to that point — the original prompt is dropped back into the input so you can edit and resend.
