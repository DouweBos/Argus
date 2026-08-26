
### Minor Changes

- c2680dd: Phone notifications no longer need any setup. Argus encrypts each one for your device before it leaves your machine and sends it through a relay that only ever handles the ciphertext — it can't read your notifications, and it won't deliver one unless your phone authorised the sender. Browsers are still reached directly.
- 1096d49: The Argus Remote mobile app now uses the Argus app icon on the home screen, including an adaptive and themed icon on Android.
- 080f717: The Argus Remote phone app can now be paired with several computers. Its new home screen lists every paired computer with its connection state, connects to whichever one you tap, and lets you rename or unpair them.
- 918142e: Approval notifications now carry Approve and Deny buttons — on the macOS banner, on your phone, and in the browser. Answering from the button sends the decision straight to the agent without opening anything, and it still works if you tap it while offline: the answer is queued and delivered as soon as you reconnect.
- 918142e: Argus can now wake your paired phone with a real notification when an agent finishes, fails, or needs approval — even with the app closed. Add your Apple and/or Firebase push credentials under Settings → Remote access; the notifications go straight from your computer to Apple or Google, with no Argus server in between.
- 918142e: The web client can now notify you after you close every tab. Turn on Background push in its settings — your computer signs and encrypts these itself, with no Argus server in between and nothing to configure. Needs an https address, so use a tunnel rather than a plain LAN one.

### Patch Changes

- 080f717: You can now attach a copied screenshot to a message in the mobile app. A paste button appears next to the camera whenever there's an image on the clipboard.
- 1b4e7d3: Backing out of a chat in the web client now returns you to the top of the home screen instead of leaving it scrolled down.
- d08c489: Zed now shows up in the "Open in" list when it's installed.
- Updated dependencies [e0c539b]
  - @argus/peacock@0.12.2

