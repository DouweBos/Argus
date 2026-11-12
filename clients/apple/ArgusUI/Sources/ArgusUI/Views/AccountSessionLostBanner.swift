import ArgusCore
import SwiftUI

/// The Argus account's sign-in went away with this device's keys kept: say so
/// wherever the user is, with the way back in one tap away.
public struct AccountSessionLostBanner: View {
  let reason: AccountSessionLossReason
  /// What stays connected while signed in: "your hosts and phone", "your computers".
  let keeps: String
  let onSignIn: () -> Void
  let onDismiss: () -> Void

  public init(
    reason: AccountSessionLossReason, keeps: String, onSignIn: @escaping () -> Void,
    onDismiss: @escaping () -> Void
  ) {
    self.reason = reason
    self.keeps = keeps
    self.onSignIn = onSignIn
    self.onDismiss = onDismiss
  }

  public var body: some View {
    let copy = Self.copy(reason, keeps: keeps)
    Banner(
      text: copy.text, tone: .warning, title: copy.title, actionLabel: "Sign in again", actionTone: .primary,
      action: onSignIn, onDismiss: onDismiss)
  }

  static func copy(_ reason: AccountSessionLossReason, keeps: String) -> (title: String, text: String) {
    let again = "Sign in again to keep \(keeps) connected."
    return switch reason {
    case .expired: ("Your Argus sign-in expired", again)
    case .inactive: ("Your Argus sign-in timed out", "It went unused for too long. \(again)")
    case .endedElsewhere: ("Your Argus sign-in was ended", "It was signed out somewhere else. \(again)")
    case .unknown: ("You're signed out of Argus", again)
    }
  }
}
