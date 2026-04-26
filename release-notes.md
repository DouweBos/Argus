
### Patch Changes

- ebf055e: Stop mistakenly rewriting `git`, `ls`, and other commands that mention the conductor project path. Conductor device-flag injection now only fires for actual `conductor` CLI invocations, and a stalled simulator pool can no longer wedge agent tool approvals.
- ea9252e: The merge button is now disabled with a clear explanation when the base branch's worktree has uncommitted changes that the merge would overwrite, instead of letting the merge fail mid-flight.
- 447800a: Fix the in-app updater showing "No releases found" by letting electron-builder upload `latest-mac.yml` to the GitHub release. The houwert.dev proxy reads that manifest off the release, so suppressing its upload meant the feed always 404'd.

