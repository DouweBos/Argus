---
"argus": minor
---

Orchestrator agents can now create a session and spawn an agent in it with a single `create_session` call by passing a `prompt`. The call waits for setup to finish, then starts the agent and dispatches the prompt — replacing the common `create_session` + `spawn_agent` pair.
