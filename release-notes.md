
### Minor Changes

- e812ef1: Messages you queue up for a busy agent now live on your computer instead of in whichever client you typed them into. Reloading the web client or reinstalling the phone app no longer throws the queue away, and the same queue is visible and editable from all three.
- e812ef1: A round of fixes to the phone and web clients: tapping any image now opens a full-screen viewer, images attached to a queued message are visible instead of hidden, removing a queued message or stopping an agent asks first, scrolling a chat puts the keyboard away, you can jump to a running device from inside a chat, and the "Connected" label in the header is now just a small dot.
- e812ef1: The mobile app can now look back at agents that have already finished: each project lists its recently stopped agents, opens their full transcript, and can pick the conversation back up in a new agent. Long runs of tool calls also fold into a single line you can tap open, instead of scrolling past every one.

### Patch Changes

- e812ef1: Pasting an image into the mobile message box now works: use the keyboard's own Paste action instead of a separate paste button.
- e812ef1: You now get a notification when an agent asks you a question or puts a plan up for approval. Previously these only reached you if the agent also happened to need permission, so in auto mode they waited silently.
- b9ce61b: Fixes three things in the mobile app: notifications about different events no longer replace each other on the lock screen, tapping a pushed notification now opens the agent it came from, and the keyboard no longer covers the message box.
- b919a71: Background push settings are down to a single switch. The Apple and Firebase credential fields are gone — notifications go through the Argus relay, which holds those credentials, so there was never anything to fill in.
- e812ef1: A chat resumed or forked on the desktop no longer shows up empty in the web and phone clients until you send a message.

