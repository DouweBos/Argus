---
"argus": patch
---

Fix a crash ("Cannot read properties of undefined (reading 'matchAll')") that could take down the whole chat view when a message or tool-call block had no text.
