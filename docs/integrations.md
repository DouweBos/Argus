# Integrations

Argus connects to Linear and Figma itself, with its own sign-in kept on this
machine. Nothing depends on an MCP server staying signed in.

## Connecting Linear

Open **Settings → Integrations** and click **Sign in with Linear**. Your
browser opens; approve Argus there and the sign-in comes back to Argus on
`127.0.0.1:47620`. It works for any Linear workspace, signs in as you, and
refreshes itself. If your workspace requires admins to approve third-party
apps, Linear asks an admin first.

You can always paste a Linear personal API key instead. Create one in Linear
under **Settings → Security & access → Personal API keys**. A personal key
doesn't expire and only acts as you.

Argus checks the credential with Linear before saving it. Then it shows the
account and workspace you're connected as. The credential is encrypted with
this machine's secure storage in `~/.argus/integrations.json` and never
leaves the host.

If Linear later rejects it (because it was revoked, for example), the
integration is marked **Signed out**. Reconnect it from the same screen.
Disconnecting deletes the saved credential.

## Issues

With Linear connected, the sidebar has an **Issues** entry: your open
assigned issues, grouped into In progress, Todo and Backlog. An issue an
agent is already working on shows **Open session**. A session counts as
working on it when it was started from the issue, or its branch is the
issue's Linear branch name. Any other issue shows **Start agent**, which
opens the start composer of the project picked at the top with the issue
attached. The list refreshes every five minutes, or with **Refresh**.

## Starting from an issue

With Linear connected, the start composer has an **Issue** chip. Open it to
search your issues (with no search, it lists your open assigned issues). You
can also paste a Linear issue link into the prompt and it attaches itself.

Each attached issue becomes the agent's context: the description, the
comments, and any screenshots embedded in the issue. Whatever you type in
the prompt comes after it. Leave the prompt empty and the agent just works
on the issue.

Starting in a **new worktree** gives every issue its own session and agent,
so picking three issues starts three agents in parallel. Each branch gets
Linear's own branch name for the issue, so if your team uses Linear's GitHub
integration, the pull request links to the issue and moves it along by
itself. The session shows the issue as a chip that opens it in Linear.

Starting in the **current checkout** gives a single agent all the attached
issues as context.

When work starts, the issue moves to its team's first "started" state. Turn
that off with **Move to In Progress** in Settings → Integrations.

## Agents

While Linear is connected, every agent gets three Argus tools:

- `linear_get_issue` reads an issue with its comments and screenshots.
- `linear_search_issues` searches issues, or lists yours.
- `linear_comment` comments on an issue as you.

They use Argus's connection, so agents don't need a Linear MCP server of
their own.

## Reporting back

When a session's work lands, Argus comments on its issue. The comment has the
pull request link (or the branch that was merged), the commit subjects, and a
screenshot of every simulator the session's agents are using at that moment.
Reviewers and PMs see the result without checking out the branch.

**Report back** in Settings → Integrations decides when this happens: when a
pull request is opened from Argus (the default), when the session merges, or
never. A session started by hand still gets a report if its branch name
contains the issue identifier, because Argus asks Linear which issue the
branch belongs to.

## Connecting Figma

Open **Settings → Integrations** and click **Sign in with Figma**. Your browser
opens; approve Argus there and the sign-in comes back to Argus on
`127.0.0.1:47621`. Figma only hands out tokens to an app that proves itself
with a secret, so that one step goes through `houwert.dev/argus/figma`, which
holds the secret and passes Figma's answer straight back. Nothing is stored
there, and the token refreshes itself.

You can also paste a Figma personal access token instead (**Use an API key
instead**). Create one in Figma under **Settings → Security → Personal access
tokens**, with read access to file content and comments. Personal tokens
expire, so you'll reconnect when they do.

## Designs

Paste a Figma frame link (one with `node-id` in it) into the start composer
and it becomes a design chip. Figma links in an attached Linear issue are
picked up automatically. Those only go to that issue's agent.

The agent is told to match the frames. It gets a `figma_get_frame` tool that
returns the rendered frame, its layers trimmed to layout, sizes, colors and
text, and the open designer comments on it. The agent is also told to
compare a simulator screenshot against the frame before it calls the work
done.

Once a session has designs, the runtime panel gets a **Design** mode next to
Simulate. It shows the frame and a screenshot of the device side by side, or
under a slider. Retake the screenshot after a change. With several frames,
pick one from the list.

## Automations

An automation that watches Linear fetches your assigned open issues through
this connection, before its agent starts. That costs no tokens and doesn't
depend on an MCP sign-in. Each issue carries its labels, so a playbook can
pick up only the issues labelled, say, `argus`. Without a connection, the
source falls back to asking the agent to fetch issues through a Linear MCP
server, if one is configured.

## Filing bugs from the simulator

With Linear connected, the runtime panel's title bar has a Linear button.
It takes a screenshot of the simulator or emulator and opens **File in
Linear**. Pick a team, write a title and a description, then:

- **File** creates the issue, assigned to you, with the screenshot and the
  device name under the description, and opens it in Linear.
- **File & start agent** creates it the same way and opens the project's
  start composer with the issue attached, ready to hand to an agent in a new
  worktree.

## On iPhone and the Mac app

On a paired iPhone with control, **New agent** offers **Add Linear issue**
when the computer has Linear connected. Search or pick from your open
issues, select one or several, and **Start N agents**: each issue gets its
own worktree on Linear's branch name and an agent that starts from the
issue, with anything you typed after it. A session started from an issue
shows the issue at the top of its section; tap it to open it in Linear.
The inbox also links to **Linear issues**, the same list as the desktop's
**Issues** screen: **Open session** on an issue an agent is already on, or
**Start agent** in the project picked at the top.

The computer's page in the iPhone app's settings lists which integrations
are connected and as whom. Connecting and disconnecting stay on the
computer, so API keys never travel to the phone. Filing bugs from the
simulator and comparing against Figma frames are desktop-only.

The Mac app has the same flow in **New Session**: **Add Linear Issue…**
picks the issues, and **Start N Agents** creates a session per issue. The
session's context card shows its issue and opens it. With Linear connected,
the sidebar has the same **Issues** screen as the desktop. **Settings →
Integrations** connects Linear and Figma with a key, reconnects or
disconnects them, and holds the two Linear options above.
