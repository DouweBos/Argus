
### Minor Changes

- f38bb67: Branch janitor now spots branches finished by a squash merge, which leave no trace in the commit history but do delete their remote. It also covers local branches with no Argus session behind them, proposing the exact command to clear each one.
- b8780e4: Runs can now be deleted outright — from a run's page or its row in the history — removing the report and any proposals it raised. Failed runs can still just be dismissed from the inbox when you only want them out of the way.

