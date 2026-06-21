
### Minor Changes

- e5400b6: Spawned agents are now correctly linked to the agent that created them. Parent-child relationships are tracked automatically, so delegation between agents shows the right lineage without manual setup.
- 963395a: You can now sign in, sign out, and switch Claude accounts from Settings → Claude account, without dropping to a terminal.
- feaa15a: Update Conductor to 0.20.0

### Patch Changes

- 874bb82: Fix the permission mode dropping to Ask after approving Exit Plan Mode. The restore now reliably lands after the plan exit, so agents launched in Auto stay in Auto.
- 1373d96: Correctly detect the 1M-token context window for newer models like Opus 4.8, so the context usage indicator no longer reports against a 200k limit.

