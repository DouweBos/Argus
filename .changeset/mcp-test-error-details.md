---
"argus": minor
---

Sign in to OAuth-protected MCP servers (Figma, Linear, etc.) directly from Argus. A failed connectivity test now shows a "Sign in with browser" button when the server returns 401, walks through the OAuth 2.1 flow, and stores the resulting token securely in your OS keychain. Spawned agents inherit the bearer transparently.
