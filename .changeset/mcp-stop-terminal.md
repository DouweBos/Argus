---
"argus": minor
---

Agents can now stop a dev server or other run they started, the same way Ctrl-C would, and the Stop button now reliably shuts down wrapped commands like `pnpm` → `turbo` → `vite` without leaving stray processes behind.
