---
"argus": patch
---

Fix custom runners being ignored: the runner picked in the new-session dialog (and the default runner set in Settings) is now actually used for the session, and switching runners resets the model to that runner's own default.
