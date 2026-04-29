---
"argus": patch
---

Fix renderer telemetry events (including the in-app feedback dialog) not reaching PostHog in production builds. Renderer events are now routed through the main process instead of going direct from the file:// origin.
