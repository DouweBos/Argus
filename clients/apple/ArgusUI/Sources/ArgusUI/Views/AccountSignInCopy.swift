import ArgusCore

/// The sign-in form's heading: plain sign-in, or the identity action that asked for it.
public enum AccountSignInCopy {
  public static func title(_ action: AccountStore.IdentityAction?) -> String {
    switch action {
    case .reset: "Sign in again to reset your account"
    case nil: "Sign in to Argus"
    }
  }

  /// Nil for a plain sign-in, which each app words itself.
  public static func detail(_ action: AccountStore.IdentityAction?, deviceNoun: String) -> String? {
    switch action {
    case .reset:
      "Resetting needs proof that it's you. This \(deviceNoun) stays on your account either way; once you're signed in, choose Reset account again."
    case nil: nil
    }
  }
}
