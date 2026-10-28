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
