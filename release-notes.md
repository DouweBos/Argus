
### Patch Changes

- 519afe0: Argus no longer polls `git diff` every 2 seconds for sessions without an active agent. Idle workspaces with many sessions now stay quiet instead of running a constant fan-out of git subprocesses.

