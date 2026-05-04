---
"argus": patch
---

Remove the redundant "Native sim bridge" preflight check. The bridge ships inside the app bundle, so the check always passed in release builds.
