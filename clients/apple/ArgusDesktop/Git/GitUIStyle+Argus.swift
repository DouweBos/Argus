import ArgusUI
import GroveUIKit
import SwiftUI

extension GitUIStyle {
  /// The theme and text size as GroveUIKit's style; the one place they're mapped.
  static func argus(_ theme: Theme, scale: CGFloat) -> GitUIStyle {
    GitUIStyle(
      background: theme.bg, surface: theme.surface, surfaceRaised: theme.bgSecondary, border: theme.border,
      textPrimary: theme.text, textSecondary: theme.textSecondary, accent: theme.accent,
      pillSelected: theme.pillSelected, pillSelectedText: theme.pillSelectedText,
      success: theme.success, warning: theme.warning, danger: theme.error,
      // Peacock has no blue of its own: what Grove tints blue follows the colour theme.
      info: theme.accent, renamed: theme.brandPurple, lanes: GitGraphPalette.lanes,
      syntax: Syntax(
        keyword: theme.syntaxKeyword, string: theme.syntaxString, comment: theme.syntaxComment,
        number: theme.syntaxNumber, type: theme.syntaxType),
      fontScale: scale, showsPointingHand: true)
  }
}

extension GitUIHost {
  /// Argus's clipboard, and its code view where the diff shows the file as it is now.
  static func argus(openLine: (@MainActor @Sendable (Int) -> Void)?) -> GitUIHost {
    var host = GitUIHost(copy: { Clipboard.copy($0) })
    if let openLine { host.openFile = { _, line in openLine(line ?? 1) } }
    return host
  }
}

private struct ArgusGitUI: ViewModifier {
  @Environment(\.theme) private var theme

  func body(content: Content) -> some View {
    // Reading the scale here restyles the kit's tables on a Display size change.
    content.gitUIStyle(.argus(theme, scale: TextScale.shared.factor))
  }
}

extension View {
  /// Dresses the kit views below as Argus.
  func argusGitUI() -> some View { modifier(ArgusGitUI()) }
}
