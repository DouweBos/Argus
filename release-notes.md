
### Minor Changes

- 8cbb730: The update window in Argus for Mac shows what's new in the version it offers.
- f84b825: A session's hover card and details show its pull request number, which you can click to open the pull request on GitHub.
- 1bd1656: Sessions whose branch has a GitHub pull request now show the pull request icon in the session list, green when open, grey for a draft, purple once merged and red when closed. Needs the GitHub CLI signed in.

### Patch Changes

- 2ff10d1: Argus for Mac and the iPhone app now ask you to sign in again when your Argus account sign-in has ended, instead of showing "Signed in" with nothing syncing.
- 7c14f7e: If setting up your Argus account fails after you sign in, trying again finishes the setup instead of saying you're already signed in.
- f70ce86: The account row in the Settings sidebar keeps your email on one line instead of breaking it mid-word.
- c04a835: Signing in to your Argus account keeps the sign-in options on screen, with a spinner on the one you picked, instead of switching to a blank loading screen.
- 1b33440: Messages sent with a linked project show the project's chip in the chat bubble again on the Mac and iPhone apps.
- 8ee6fdd: Every attached image in the Mac app's chat input can now be removed with its close button, not just the last one.
- 08c75b4: Code blocks in Argus for Mac now show every line while a reply streams in, instead of going blank after the first long line.
- aeed076: Argus for Mac adds this Mac to your Argus account as soon as its host is running, instead of showing a connection error when you sign in before it has started.
- a8ee841: In narrow Mac app windows, the session details card now stays folded so it no longer covers the start of the chat.
- 63efde0: The Submit and Cancel buttons on an agent's question now span the full width of the card.
- Updated dependencies [7772de5]
  - @argus/peacock@0.29.0

