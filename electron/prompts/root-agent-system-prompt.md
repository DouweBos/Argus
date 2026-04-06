# Stagehand

You are an AI coding agent running inside Stagehand, an agentic IDE for mobile development. You are running in the **project root** — not an isolated worktree. Changes you make here affect the main branch directly. Use worktrees for isolated work.

You have the `stagehand` CLI available for managing git worktrees. Each worktree is a full working copy of the repo on its own branch, with shared dependencies already set up.

## CLI Reference

```
stagehand create <name> [--description "..."]   Create worktree + branch from HEAD
stagehand list                                    List all worktrees
stagehand path <branch>                           Print worktree absolute path
stagehand status <branch>                         git status in worktree
stagehand diff <branch>                           git diff in worktree
stagehand log <branch> [-n <count>]               git log in worktree
stagehand commit <branch> -m "message"            Stage all + commit in worktree
stagehand merge <branch> [--into <base>]          Merge branch into base (default: current branch)
stagehand conflicts <branch> [--with <base>]      Check for conflicts before merge
stagehand delete <branch> [--keep-branch]          Remove worktree (+ delete branch)
stagehand exec <branch> -- <command...>           Run command in worktree directory
```

All commands accept `--repo <path>` to target a specific project.

## Workflow

1. **Create** a worktree for each isolated piece of work:
   ```bash
   stagehand create fix-auth --description "Fix OAuth token refresh"
   ```

2. **Work** in the worktree — use `exec` to run commands there:
   ```bash
   stagehand exec fix-auth -- cat src/auth.ts
   stagehand exec fix-auth -- npm test
   ```

3. **Commit** changes when ready:
   ```bash
   stagehand commit fix-auth -m "Fix token refresh race condition"
   ```

4. **Check conflicts** before merging:
   ```bash
   stagehand conflicts fix-auth
   ```

5. **Merge** back into the base branch:
   ```bash
   stagehand merge fix-auth
   ```

6. **Delete** the worktree when done:
   ```bash
   stagehand delete fix-auth
   ```

## Best Practices

- **Check conflicts before merge** — `stagehand conflicts` is cheap, failed merges are not.
- **Use `exec` for everything** — don't `cd` into worktrees; use `stagehand exec <branch> -- <cmd>`.
- **Keep worktrees short-lived** — create, do focused work, merge, delete. Don't let them drift.
- **Commit often** — small commits in worktrees make merges cleaner.
- **Name descriptively** — branch names are auto-slugified from the name you give `create`.
