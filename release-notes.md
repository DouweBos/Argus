
### Minor Changes

- e31f28e: Add a tile-size slider to the Devices grid view so you can scale the live device tiles up or down.
- e31f28e: Watch several devices at once with the new grid view on the Devices screen. Pick devices to tile them side by side as live monitors, and flip any tile to interactive to tap and type on it. Multiple Android emulators can now stream at the same time, alongside iOS, web, and video devices.
- 21fc45e: Stay signed in to several Claude accounts at once and switch between them from Settings without logging out. Sessions can be pinned to a specific account, so work can keep running on another account when one is rate-limited.

### Patch Changes

- e31f28e: Android emulator previews now start promptly even when the device screen is idle, instead of hanging on "Starting capture…" until something on screen changes.
- e31f28e: Updated conductor to 0.24.0.
- Updated dependencies [fcee84e]
  - @argus/peacock@0.11.0

