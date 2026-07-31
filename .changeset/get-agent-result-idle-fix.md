---
"argus": patch
---

Fix `get_agent_result` refusing to return a finished agent's result when the agent had completed its turn but its process was still alive (status "idle").
