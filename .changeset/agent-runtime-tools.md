---
"argus": minor
---

Stop agents from spawning their own dev servers via Bash and colliding with the runtime you already have open. Agents now have full read/wait access to configured run commands: `list_run_commands` to discover what's in `.argus.json`, `trigger_run` to (re)start it, `wait_for_terminal` to block until a "ready" pattern appears or the process exits (with the captured output and exit code), and `read_terminal` for non-blocking snapshots of recent output. Run-command terminals now keep their captured output around after exit so post-exit reads still work.
