---
"argus": minor
---

Run commands now auto-start their dependencies. When you start a run command whose "Requires running" list includes another command that isn't up, Argus launches the dependency (and its dependencies) first instead of refusing to start.
