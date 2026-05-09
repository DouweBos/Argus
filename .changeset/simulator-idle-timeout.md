---
"argus": patch
---

Auto-disconnect simulator captures left running after the device view is dismissed. The native bridge stays alive for 10 minutes so reopening the view reuses it instantly, then shuts down on its own if nothing reconnects.
