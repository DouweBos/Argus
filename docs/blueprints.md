# Blueprints — new projects from your own recipe

Starting a small app usually means the same five steps: create the GitHub
repository, clone it, add it to Argus, start an agent, and tell it "set this up
like app X — same structure, build, signing and releases". A blueprint does all
of that from a name and a description.

Blueprints are yours: each machine keeps its own, like automations. Nothing is
built in.

Blueprints live at **`/blueprints`**. Start a project from the **New Project
from Blueprint** item in the app menu, the sidebar's add menu, the command
palette or Home.

---

## What a blueprint holds

| Field                          | What it does                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Name** and **summary**       | Shown in the picker.                                                                                                |
| **Folder**                     | Where new projects go, e.g. `~/Work/Apps`. The project lands in `<folder>/<name>`.                                  |
| **References**                 | Local projects the agent studies, each with a note on what to take from it. Each becomes a related project.         |
| **Scaffold**                   | **Empty** (a fresh repo with a README) or **GitHub template** (`owner/name` of a template repository).              |
| **GitHub**                     | Whether to create a repository, under which owner (empty means your `gh` user) and whether it is private or public. |
| **Copy project settings from** | One of the references. Its run commands, setup and environment on this machine are copied to the new project.       |
| **Instructions**               | Markdown the agent starts with.                                                                                     |
| **Agent**                      | Runner, model and permission mode. Empty fields use your app defaults.                                              |

### Placeholders

The instructions can use:

| Placeholder       | Filled with                                  |
| ----------------- | -------------------------------------------- |
| `{{name}}`        | The project name                             |
| `{{description}}` | The description you typed                    |
| `{{repo}}`        | The GitHub URL, or a note that there is none |
| `{{path}}`        | The project's folder on disk                 |

The agent's first message is the name and description, the rendered
instructions, the reference projects with their absolute paths and notes, the
repository URL, and a reminder to commit as it goes and push to `origin`.

---

## Creating a project

You enter a name (letters, digits, dots, dashes and underscores) and a
description. The folder, GitHub owner and visibility can be changed for this
one project without touching the blueprint. Argus then works through four
steps, shown live:

1. **Check** — the folder doesn't exist yet, the references are git
   repositories, and with GitHub on: `gh` is signed in and the repository name
   is free.
2. **Create repository** — from a template: `gh repo create --template`, then
   a clone (retried for a few seconds while GitHub generates it). Empty: `git
init`, a README commit, and with GitHub on `gh repo create --source . --push`.
3. **Add to Argus** — the project is added, its settings are copied or
   inferred, and the references become related projects.
4. **Start agent** — an agent starts on `main` in the project with the
   blueprint's brief.

When a step fails, the error is shown on that step and nothing is undone. A
repository or folder that was already created stays where it is, and the error
says so: deleting a repository on GitHub is not something Argus does for you.

---

## Generating a blueprint from projects

**Generate from Projects** in the Blueprints toolbar, or **Create Blueprint
from Project** on a project, has Claude read one or more of your projects —
stack, layout, build and tests, signing, CI and release workflows, update
feeds, project settings and the conventions in CLAUDE.md — and write a
blueprint. With several projects it keeps what they share. The instructions
name concrete files to copy, so later agents mirror them instead of guessing.

Claude only reads: it writes nothing and runs nothing. The GitHub owner and
visibility come from the projects' `origin`, and a project that is a GitHub
template repository is suggested as the scaffold. Nothing is saved until you
review the draft in the editor and save it.

---

## Requirements

- The [GitHub CLI](https://cli.github.com), signed in with `gh auth login`,
  for anything that touches GitHub: creating a repository, a template scaffold,
  and the owner and template hints when generating.
- `git` and Claude Code, which Argus needs anyway.

## Where state lives

- `$ARGUS_HOME/blueprints.json` — your blueprints.
- `$ARGUS_HOME/blueprint-runs.json` — the last 50 projects created from them,
  with each step's outcome.

## On the phone

The iPhone app lists, edits, generates and runs blueprints on the computer it
is paired with. It has no folder picker: a project goes into the blueprint's
folder unless you type another path.
