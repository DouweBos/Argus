import SwiftUI

/// Another device took this one off the Argus account: say so wherever the
/// user is, with joining again one tap away.
public struct AccountRemovedBanner: View {
  /// "Mac" or "iPhone": what this device is called in the copy.
  let deviceNoun: String
  let onSignIn: () -> Void
  let onDismiss: () -> Void

  public init(deviceNoun: String, onSignIn: @escaping () -> Void, onDismiss: @escaping () -> Void) {
    self.deviceNoun = deviceNoun
    self.onSignIn = onSignIn
    self.onDismiss = onDismiss
  }

  public var body: some View {
    Banner(
      text: "Sign in to ask to join again; a device still on your account approves this \(deviceNoun).",
      tone: .warning, title: "This \(deviceNoun) was removed from your account", actionLabel: "Join again",
      actionTone: .primary, action: onSignIn, onDismiss: onDismiss)
  }
}
