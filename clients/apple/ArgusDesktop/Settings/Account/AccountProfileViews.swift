import ArgusCore
import ArgusUI
import SwiftUI

/// The top of the settings list, as a card like the phone's: who is signed in,
/// opening Argus Account.
struct SettingsProfileNavItem: View {
  @Environment(AccountStore.self) private var account
  @Environment(\.theme) private var theme
  let selected: Bool
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        AccountProfileSummary(account: account, avatarSize: TextScale.shared(34), compact: true)
        Spacer(minLength: 0)
        Image(systemName: "chevron.right")
          .font(.scaled(size: 10, weight: .semibold))
          .foregroundStyle(theme.textMuted)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 9)
      .background(fill, in: .rect(cornerRadius: 10))
      .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(theme.border))
      .contentShape(.rect(cornerRadius: 10))
    }
    .buttonStyle(.argusPlain)
    .onHover { hovering = $0 }
    .padding(.bottom, 6)
    .accessibilityLabel("Argus Account")
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  private var fill: Color {
    if selected { return theme.selection }
    return hovering ? theme.bgHover : theme.surface
  }
}

/// Avatar, name and email at the top of Argus Account.
struct AccountProfileHeader: View {
  @Environment(AccountStore.self) private var account

  var body: some View {
    SettingsGroup {
      AccountProfileSummary(account: account, avatarSize: 48)
    }
  }
}
