
### Minor Changes

- 63b097f: Add custom runners: point Claude Code at another Anthropic-compatible endpoint (like callstack.ai's Apex) from Settings → Custom runners, then pick it per session or as your app default. Start from a template, paste your API key, and the runner's models show up in the model picker.

### Patch Changes

- e33950f: Run commands now pick up version managers configured in your shell rc file, so tools like `bundle`, `ruby`, and `node` resolve to the same versions you get in a terminal.

