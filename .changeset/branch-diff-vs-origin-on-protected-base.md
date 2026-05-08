---
"argus": patch
---

Sessions whose base branch is protected now show their branch diff against `origin/<base>` instead of the local copy, so the file list reflects what a pull request would actually contain even when the local base branch is out of date.
