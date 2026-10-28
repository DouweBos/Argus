import ArgusCore
import ArgusKit
import SwiftUI

/// What the account header says in each phase.
public enum AccountProfileText {
  public static func title(phase: AccountStore.Phase, profile: AccountProfile?) -> String {
    if phase == .signedOut { return "Sign in to Argus" }
    return profile?.displayName ?? "Argus account"
  }

  public static func subtitle(phase: AccountStore.Phase, profile: AccountProfile?) -> String? {
    switch phase {
    case .signedOut: "Reach your computers without a QR code"
    case .loading, .signingIn, .settingUp: profile?.subtitle ?? "Checking your account…"
    case .awaitingApproval: "Waiting for device approval"
    case .ready: profile?.subtitle ?? (profile?.displayName == nil ? "Signed in" : nil)
    }
  }
}

/// Avatar, name and email of the signed-in person, or the sign-in prompt.
public struct AccountProfileSummary: View {
  @Environment(\.theme) private var theme
  let account: AccountStore
  let avatarSize: CGFloat
  /// A sidebar row rather than a header.
  let compact: Bool

  public init(account: AccountStore, avatarSize: CGFloat = 48, compact: Bool = false) {
    self.account = account
    self.avatarSize = avatarSize
    self.compact = compact
  }

  public var body: some View {
    let profile = account.phase == .signedOut ? nil : account.profile
    HStack(spacing: compact ? 8 : 12) {
      AccountAvatar(profile: profile, size: avatarSize)
      VStack(alignment: .leading, spacing: 2) {
        Text(AccountProfileText.title(phase: account.phase, profile: profile))
          .font(compact ? .scaled(size: 13, weight: .medium) : .scaled(.headline))
          .foregroundStyle(theme.text)
          .lineLimit(1)
        if let subtitle = AccountProfileText.subtitle(phase: account.phase, profile: profile) {
          Text(subtitle)
            .font(compact ? .scaled(size: 11) : .scaled(.subheadline))
            .foregroundStyle(theme.textSecondary)
            .lineLimit(1)
        }
      }
    }
    .accessibilityElement(children: .combine)
  }
}
