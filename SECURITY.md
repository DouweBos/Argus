# Security policy

Argus runs coding agents with access to your repositories, terminals and devices, and exposes a
remote gateway to paired phones and browsers. Security reports are taken seriously.

## Reporting a vulnerability

**Don't open a public issue.** Report privately through
[GitHub's private vulnerability reporting](https://github.com/DouweBos/Argus/security/advisories/new),
or email **douwe@douwebos.nl**.

Please include:

- what's affected (Argus for Mac, the host, the iPhone or web client, the remote gateway) and the
  version
- steps to reproduce, or a proof of concept
- the impact as you understand it

You'll get an acknowledgement within a few days. Once a fix ships you're credited in the release
notes, unless you'd rather stay anonymous.

## Supported versions

Only the latest release gets security fixes. Argus updates itself, so staying current is the fix.

## Scope

In scope: the remote gateway and pairing (Noise IK, device grants, huddle links), the permission
broker, the MCP server, command handling in the host, and anything that lets a paired client,
guest or web page do more than its tier allows.

Out of scope: what an agent you started does with the permissions you gave it, and issues in
Claude Code itself (report those to Anthropic).

### By design

- A paired device reaches every project registered on that computer, not just one. Grants limit
  what it may do (monitor, control), not which projects it sees. Huddle guests are the exception:
  they only ever see the agent and device they were invited to.
- A device with **control** can make an agent run commands on the computer. That's the feature;
  only grant control to devices you'd trust at your keyboard.
- With **Serve the web client on this network** turned on, the web client's page travels as plain
  http on the local network. It's off by default, and the settings say so.
