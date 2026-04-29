---
"argus": patch
---

Fix anonymous telemetry in production builds. Main-process events were being silently dropped because the PostHog key was only inlined into the renderer bundle.
