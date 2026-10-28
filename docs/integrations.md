# Integrations

Argus connects to Linear itself, with its own sign-in kept on this machine.
Nothing depends on an MCP server staying signed in.

## Connecting Linear

Open **Settings → Integrations** and paste a Linear personal API key. Create
one in Linear under **Settings → Security & access → Personal API keys**.
A personal key doesn't expire and only acts as you.

Argus checks the key with Linear before saving it. Then it shows the account
and workspace you're connected as. The key is encrypted with this machine's
secure storage in `~/.argus/integrations.json` and never leaves the host.

If Linear later rejects the key (because it was revoked, for example), the
integration is marked **Signed out**. Reconnect it from the same screen.
Disconnecting deletes the saved key.

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
