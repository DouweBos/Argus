---
"argus": patch
---

Fix `wait_for_agent` and `wait_for_any_agent` hanging on children that have already finished. The CLI doesn't always emit a final `session_state_changed(idle)` event (it can race with the `result` event or be skipped entirely for text-only responses), so the turn counter could stay at zero on a child that was clearly done. Orchestrator waits now key off the authoritative `result` event and resolve as soon as any waited-on child completes.
