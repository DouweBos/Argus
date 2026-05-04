---
"argus": minor
---

The Argus MCP `read_agent_transcript` tool now supports paging through long transcripts via `head_messages`, `offset`, and `limit` (in addition to the existing `tail_messages`), and reports `start_index`/`end_index` so agents can fetch the next slice.
