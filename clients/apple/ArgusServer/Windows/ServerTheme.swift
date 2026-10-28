import ArgusUI
import SwiftUI

/// Peacock's tokens for the system appearance; the server has no theme setting.
private struct Themed: ViewModifier {
  @Environment(\.colorScheme) private var colorScheme

  func body(content: Content) -> some View {
    let theme = Theme.resolved(for: colorScheme)
    content.environment(\.theme, theme).tint(theme.tint)
  }
}

extension View {
  func themed() -> some View { modifier(Themed()) }
}
