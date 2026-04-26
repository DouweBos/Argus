---
"argus": patch
---

Fix the in-app updater showing "No releases found" by letting electron-builder upload `latest-mac.yml` to the GitHub release. The houwert.dev proxy reads that manifest off the release, so suppressing its upload meant the feed always 404'd.
