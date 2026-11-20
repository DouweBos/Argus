package dev.houwert.argus.app.push

/** Background-push status, purely for what Settings tells the user. */
enum class PushState(val explanation: String) {
  Registered("Registered. Your computer can wake this phone."),
  Conflict("The push relay still has this device claimed by an older install. Wait for the old claim to lapse, or update the relay."),
  Unconfigured("Registered, but Argus on your computer has no push credentials yet."),
  Unavailable("Unavailable on this build. It was built without a Firebase project, or Google Play services are missing."),
  Unsupported("The computer you're connected to is running an older Argus. Update it to enable background push."),
  Off("Off. You'll only see alerts while the app is connected."),
  Denied("Notifications aren't allowed for Argus. Allow them in Android settings."),
  NoToken("Firebase didn't issue a push token for this install. Check that Google Play services is up to date."),
  RelayFailed("Couldn't reach the Argus push relay to register this device."),
  RegistrationRefused("Your computer refused this device's push registration."),
}
