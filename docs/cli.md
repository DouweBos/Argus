# Command line

Argus ships an `argus` command that starts, messages and reads agents from a
terminal or a script. It talks to the Argus running on this computer through
the same tools Argus's own agents orchestrate with, so whatever it starts shows
up in the app like any other agent.

## Installing

Argus writes the command to `~/.argus/cli/argus` every time it launches, so it
always matches the installed version. Put that directory on your `PATH`:

```sh
echo 'export PATH="$HOME/.argus/cli:$PATH"' >> ~/.zshrc
```

Argus has to be running for the command to work.

## Commands

```sh
argus session new <dir> <prompt|-> [--worktree <base>] [--name <name>]
                  [--model <id>] [--mode <permission-mode>] [--wait] [--timeout <s>]
argus send <agent-id> <message|-> [--wait] [--timeout <s>]
argus wait <agent-id> [--timeout <s>]
argus show <agent-id>
argus list [dir]
argus stop <agent-id>
```

- `<dir>` is any directory inside a project, `.` included. A project Argus
  doesn't know yet is added.
- Without `--worktree` the agent works in the project's own checkout. With
  `--worktree <base>` it gets a new worktree branched off `<base>`; use
  `HEAD` for the branch you're on.
- `-` reads the prompt or message from stdin.
- `session new` prints the new agent's id. With `--wait` it waits for the
  agent's turn to end and prints its answer instead.
- `--json` prints machine-readable output for every command.

## Exit codes

| Code  | Meaning                                            |
| ----- | -------------------------------------------------- |
| `0`   | Done: the agent finished its turn                  |
| `1`   | The agent's turn or the command failed             |
| `2`   | Usage error                                        |
| `3`   | The agent is waiting for input. Answer it in Argus |
| `4`   | Argus isn't running                                |
| `124` | `--timeout` elapsed before the agent finished      |

## In a script

```sh
id=$(argus session new . "Update the changelog for the last release" --worktree main)
argus wait "$id" --timeout 1800
case $? in
  0) argus show "$id" --json | jq -r .result.result ;;
  3) echo "The agent needs an answer in Argus" ;;
  *) echo "Failed" ;;
esac

git diff | argus send "$id" - --wait
```
