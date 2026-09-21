---
"argus": patch
---

Sharing an agent now checks that a public link actually reaches your Mac before handing it out, so a Tailscale funnel whose machine isn't connected to the tailnet no longer produces a dead link — Argus falls back to a working address instead, and Settings marks the tunnel as unreachable.
