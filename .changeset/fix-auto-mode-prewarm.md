---
"argus": patch
---

Fix Auto permission mode prompting on simple edits and bash calls. Prewarmed Claude subprocesses now start in Auto mode so the CLI flag is set at spawn — runtime switches to Auto from the default mode aren't honoured by Claude Code.
