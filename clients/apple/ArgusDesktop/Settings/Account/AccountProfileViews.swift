import ArgusCore
import ArgusUI
import SwiftUI

/// The top of the settings list: who is signed in, opening Argus Account.
struct SettingsProfileNavItem: View {
  @Environment(AccountStore.self) private var account
  @Environment(\.theme) private var theme
  let selected: Bool
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 0) {
        AccountProfileSummary(account: account, avatarSize: TextScale.shared(28), compact: true)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 6)
      .padding(.vertical, 5)
      .background {
        if selected || hovering {
          RoundedRectangle(cornerRadius: 6).fill(selected ? theme.selection : theme.bgHover.opacity(0.6))
        }
      }
      .contentShape(.rect(cornerRadius: 6))
    }
    .buttonStyle(.argusPlain)
    .onHover { hovering = $0 }
    .accessibilityLabel("Argus Account")
    .accessibilityAddTraits(selected ? .isSelected : [])
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
