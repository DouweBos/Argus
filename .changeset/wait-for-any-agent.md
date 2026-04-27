---
"argus": minor
---

Let orchestrator agents race multiple children with a single call. New `wait_for_any_agent` MCP tool blocks until the first of several agents finishes its turn or exits and returns which one settled — handy for fan-out workflows where you want to react as soon as any child is ready instead of picking one to block on with `wait_for_agent`.
