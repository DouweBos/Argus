---
"argus": minor
---

Branch janitor now spots branches finished by a squash merge, which leave no trace in the commit history but do delete their remote. It also covers local branches with no Argus session behind them, proposing the exact command to clear each one.
