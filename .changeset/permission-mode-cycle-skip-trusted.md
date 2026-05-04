---
"argus": patch
---

Add Claude's new smart Auto permission mode (auto-approves safe actions, asks for risky ones) and a separate Ask mode for the previous "ask before every write" behavior. Shift+Tab now reliably cycles through Auto, Ask, Plan, and Accept Edits — Trusted stays available in the picker but is skipped by the keyboard cycle since it cannot be enabled on a running agent.
