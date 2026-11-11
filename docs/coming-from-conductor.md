# Coming from Conductor

Conductor and Argus work the same way: every task gets its own git worktree
with a Claude Code agent in it. Argus can take over your projects, your
workspaces and their chats without re-doing your setup.

> This page is about the Conductor app from conductor.build. It is not about
> `conductor`, the device CLI that ships with Argus.

---

## Bring a project over

1. Add the repository in Argus (**Add repository**, or **Import from Claude
   Code** if you've used the Claude Code CLI in it).
2. When Argus offers to finish setting up the project, pick **Import from
   Conductor**. The option shows up whenever the repository has Conductor
   settings and no project config yet.
3. Review the proposed config and save it. Argus keeps it on your Mac; to
   give your team the same setup, export it from Project Settings and commit
   it as `.argus.json`.

Argus reads `.conductor/settings.toml`, with your personal
`.conductor/settings.local.toml` on top. Repositories that still use the
older `conductor.json` work too.

| Conductor                           | Argus `.argus.json`                                 |
| ----------------------------------- | --------------------------------------------------- |
| `scripts.setup`                     | `setup.commands`                                    |
| `scripts.run` (each action)         | `run` (the default action first; its `cwd` is kept) |
| `[environment_variables]`           | Exported in front of each imported command          |
| `CONDUCTOR_PORT`                    | A port per session, ten apart, from 55000 upwards   |
| `CONDUCTOR_ROOT_PATH`               | The repository's main checkout                      |
| `CONDUCTOR_WORKSPACE_PATH`, `_NAME` | The session's worktree and its folder name          |
| `CONDUCTOR_DEFAULT_BRANCH`          | The branch `origin/HEAD` points at (or `main`)      |

Argus doesn't import:

- **The archive script.** Argus has nothing that runs when a session is
  deleted.
- **`run_mode = "nonconcurrent"`.** Each run command restarts itself when
  you run it again, but starting one doesn't stop the others.
- **Cloud-only actions**, and the cloud and API variables
  (`CONDUCTOR_API_URL`, `CONDUCTOR_API_TOKEN`, `CONDUCTOR_BASE_DIR`, …).
  The review screen lists any your scripts use.
- **Environment variables from `settings.local.toml`.** That's where secrets
  belong, and a project config may be exported and checked in.

Prompts, models and git preferences have their own places in Argus: see
[Project settings](/argus/docs/project-settings) and
[App settings](/argus/docs/app-settings).

---

## Your workspaces and chats

Workspaces Conductor made under `~/conductor` show up in the project's
session list, named after their branch, as soon as the project is open in
Argus. If you moved Conductor's workspace location, Argus reads it from
`~/.conductor/settings.toml`. Conductor already ran their setup, so Argus
doesn't offer to run it again.

The Claude Code chats from those workspaces join the project's chat history
the next time Argus imports CLI chats (at launch and every ten minutes, or
**Import now**), and show up on the matching session. You can read and
resume them there.

Merging, deleting and opening a pull request work on these sessions like on
any other.
