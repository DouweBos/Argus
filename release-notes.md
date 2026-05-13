
### Minor Changes

- 04c709c: The branch view now shows a split graph next to commits when a branch has diverged from its upstream, matching the visualization used in the history view.

### Patch Changes

- ee62a98: Debug log streams now fully terminate when stopped or when Argus quits, preventing leaked `simctl` processes.
- 2c1332d: Argus now keeps at most one Claude subprocess warmed up — for the currently selected session — instead of one per ready session. Avoids tens of idle subprocesses consuming gigabytes of memory in workspaces with many sessions.
- f7e7aea: Prewarmed agents are no longer counted in the menu bar tray agent totals.

