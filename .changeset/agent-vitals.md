---
"argus": minor
---

Let orchestrator agents health-check a fan-out of children in one round trip. New `agent_vitals` MCP tool accepts a list of agent IDs and returns each one's status, turns completed, and time since the CLI last emitted any event — enough to spot a stuck or slow child without pulling its full transcript or making N separate `agent_status` calls. Unknown agent IDs come back as `status: "not_found"` rather than failing the whole call.
