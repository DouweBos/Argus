---
"argus": patch
---

Fix the updater hitting GitHub directly (and failing with a 404) instead of going through the houwert.dev release proxy. Also show a short, readable message when the feed is unreachable instead of dumping the raw HTTP response and headers into the "What's new" dialog.
