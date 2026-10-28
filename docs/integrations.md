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

With Linear connected, the sidebar has an **Issues** entry: your open Linear
issues as a board. There's a column per status and a swimlane per priority,
so what to pick up next is at the top left. Like in Linear, Triage, Backlog and
done, canceled or duplicate statuses start out as **Hidden columns** beside
the board, with their counts: click one to show it, or hide any column from
its header. Hidden columns are remembered.

**Filter** works like Linear's: pick a field, then the values it should
match, with a count next to each. Fields: team, status, status type,
assignee, creator, priority, estimate, labels, relations (sub-issue or not),
due date, created, updated, project, cycle (including **Current cycle**),
links (has a pull request) and content (text in the title or description).
Click a filter's operator to flip it between "is" and "is not", or its
values to change them. Filters are remembered per tab. Switch between issues
**Assigned** to you, ones you **Created** and ones you're **Subscribed** to.
Switch to **List** for a section per status instead.

Each card shows priority, estimate, cycle, project, linked pull requests,
labels and the assignee. **Agent on it** marks issues that already have a
session: started from the issue, or on its Linear branch.

Click a card to open the issue: its description, sub-issues, links and
comments. You can comment as yourself, change its status and priority, and
**Start agent** (in the project picked at the top) or **Open session**.
Images in descriptions are hosted by Linear and may not load in Argus; open
the issue in Linear to see them.

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
picked up automatically, and only go to that issue's agent.

Each of a session's frames is written into its worktree under
`.argus/design/` as a PNG at 3x and a JSON of its layers (sizes, colors,
fonts, text) and designer comments. The folder is kept out of git. Agents are
asked to build against them in a loop:

- `figma_get_frame` for the full spec, and `figma_export_assets` to export
  the frame's icons and small images into `.argus/design/assets/` instead of
  redrawing them.
- `design_compare` after each visible change. It renders the frame at the
  simulator's exact pixel size, diffs it against the screen, and returns the
  share of differing pixels with the design, the screenshot and a heatmap.
  The latest screenshot and heatmap are kept in `.argus/design/compare/`.
- `conductor assert-screenshot <reference.png>` works on the same files as a
  pass/fail gate.

Pull requests opened from Argus end with the ticket and the design frames.
The Linear comment Argus posts shows each design next to the implementation
screenshot.

## Design viewer

Figma links open inside Argus instead of the browser: links in an issue's
description, comments and Links, the design chips in the start composer, and
the chips next to a session's name in the title bar and on its home. The
viewer shows the frame — fit to the window, zoom with the controls, pinch or
⌘-scroll, drag to pan — with the file's name and when it was last edited, and
**Open in Figma** for the real thing. Beside it:

- **Layers** — the frame's layers, indented by depth, with their size, fill
  color, font and text.
- **Comments** — what designers left on the frame.
- **Pages** — every page of the file and its frames; click one to view it.

Opened from a session, the viewer warns when the design has changed since the
session started, and **Compare with simulator** renders the frame at the
session's device's pixel size and diffs it against the screen: the share of
pixels that differ, and the design and screenshot under a slider, side by
side, or as a heatmap. The runtime panel's **Design** mode shows the same
comparison, with **Open in viewer**. The session's issue chip opens the issue
over the Issues board; **Open in Linear** is in there.

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
shows the issue and its Figma frames at the top of its section, and the
agent screen has the same references under its paperclip button; tap the
issue to read it in the app, or a frame to open it in the design viewer.
The inbox also links to **Linear issues**: your Assigned, Created or
Subscribed issues in a section per status, with the same cards as the
desktop. Tap one to read it in full, with its sub-issues, links and
comments; with control you can also change its status and priority,
comment, and **Start agent** or **Open session**. Figma links in an issue
open in the design viewer instead of the browser.

The design viewer shows the frame to pinch and pan, its layers with their
size, text, font and fill, the designers' comments, and the file's pages and
frames to move between, with **Open in Figma**. Opened from a session, it
says when the design has changed since the session started, and **Compare
with Simulator** diffs the frame against one of the computer's running
simulators or emulators: the share of pixels that differ, and the design,
the screen and the differences one at a time.

The computer's page in the iPhone app's settings lists which integrations
are connected and as whom. Connecting and disconnecting stay on the
computer, so API keys never travel to the phone. Filing bugs from the
simulator is desktop-only.

The Mac app has the same flow in **New Session**: **Add Linear Issue…**
picks the issues, and **Start N Agents** creates a session per issue. The
session's context card lists its issue, which opens in the Issues inspector,
and each of its Figma frames, which open in the design viewer; each row's
menu also opens it in Linear or Figma. The viewer is the same as on the
phone, with the layers, comments and pages beside the frame, and compares
against the simulator or emulator picked for the session in the runtime
panel. Figma links in an issue's inspector open there too. With Linear
connected, the sidebar has the same **Issues** board as the desktop, with
the same scopes and a Board/List switch it remembers; clicking a card opens
the issue in an inspector beside the board. **Settings → Integrations** connects
Linear and Figma with a key, reconnects or disconnects them, and holds the
two Linear options above.
