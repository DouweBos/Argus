---
"argus": minor
---

Make `agent_vitals` actually answer "is this child making forward progress?". The CLI's `status` field flips to `idle` between turns, which made fan-outs look parked even while their children were actively iterating. Vitals now also track lifetime tool-use count, the timestamp and name of the most recent tool call, and the most recent file mtime in the agent's worktree (which catches dev servers / watchers / codegen the agent kicked off in the background).
