---
"argus": patch
---

Harden remote control security: approving an agent's tool prompts now requires granting a device the "control" role (not just "monitor"), remote devices can no longer switch agents into unattended bypass-permissions mode, and remote file browsing and session access stay confined to your registered projects. Also caps unauthenticated connections and pins the diagram renderer's sanitizer.
