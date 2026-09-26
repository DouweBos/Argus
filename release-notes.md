
### Minor Changes

- a73842e: Each automation can opt out of retrying on another Claude account when it hits a usage limit, from the desktop editor or the phone.
- cff9f8f: When an automation run hits a Claude usage limit, it retries on your other signed-in Claude accounts before failing.

### Patch Changes

- 7720bb2: Automation runs that hit a usage limit or end in an error are now marked as failed instead of succeeded.

