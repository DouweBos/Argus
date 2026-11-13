# Command line and MCP

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

## MCP for agents outside Argus

Agents running outside Argus can use the same tools over MCP: Claude Code or
Codex in a terminal, a cloud assistant, a bot. They sign in over OAuth, and
you approve each one on this Mac.

1. Turn on **Remote Access**, then **Let MCP clients sign in** under
   **Settings → Remote Access → MCP clients**.
2. Add the address shown there to your client. For Claude Code:

   ```sh
   claude mcp add --transport http argus https://<your-mac>/mcp
   ```

   On this Mac itself, `http://127.0.0.1:47615/mcp` works too.

3. Sign in from the client (`/mcp` in Claude Code). A browser page opens with a
   six-digit code. In Argus, the same request shows up under **MCP clients**
   with that code: pick what it may do and click **Approve**.

| Access      | What the client can do                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read only   | List projects, sessions and agents, read diffs, transcripts, terminals and results, wait on agents                                                                           |
| Supervised  | Also start, message, interrupt and stop agents, and run a project's run commands. Agents it starts ask you before every tool use, and only in projects already open in Argus |
| Full access | Also merge, delete sessions, write files and start agents in any permission mode                                                                                             |

No client gets the tools that act on your Linear, Figma or GitHub sign-ins,
or on automations. The endpoint is only served over this Mac's tunnel (https),
your tailnet and the Mac itself, never in the clear on your local network.

Each signed-in client is listed under **MCP clients** with when it was last
used. Change its access there, or **Revoke** it: its tokens stop working and
any live connection drops at once.
