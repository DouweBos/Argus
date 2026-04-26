
### Patch Changes

- 8641df4: Fix "Restart & install" doing nothing after an update finished downloading. On macOS the in-app updater closes the window to terminate, but the close handler was hiding it instead, so the install never ran.

