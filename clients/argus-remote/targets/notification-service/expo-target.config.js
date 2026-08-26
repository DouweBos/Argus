/**
 * Notification Service Extension.
 *
 * Pushes arrive sealed — the relay that forwards them can't read them — so the
 * alert Apple delivers is a placeholder plus an encrypted blob. This target
 * decrypts it on-device and swaps in the real title, body, and quick actions
 * before anything reaches the lock screen.
 *
 * It shares an App Group with the app purely to read the key the app minted;
 * an extension is a separate process and can't see the app's own storage.
 */
module.exports = {
  type: "notification-service",
  name: "ArgusNotificationService",
  entitlements: {
    "com.apple.security.application-groups": ["group.dev.houwert.argus.remote"],
  },
};
