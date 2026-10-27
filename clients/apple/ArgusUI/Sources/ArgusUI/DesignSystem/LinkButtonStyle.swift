import SwiftUI

/// A text-only action drawn in the theme's accent. The system `.link` style
/// always uses macOS's link blue and ignores the app's tint.
public struct AccentLinkButtonStyle: ButtonStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    AccentLinkLabel(configuration: configuration).clickable()
  }
}

private struct AccentLinkLabel: View {
  @Environment(\.theme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  @State private var hovering = false
  let configuration: ButtonStyleConfiguration

  var body: some View {
    configuration.label
      .foregroundStyle(isEnabled ? theme.accent : theme.textMuted)
      .underline(hovering && isEnabled)
      .opacity(configuration.isPressed ? 0.6 : 1)
      .contentShape(Rectangle())
      .onHover { hovering = $0 }
  }
}

extension ButtonStyle where Self == AccentLinkButtonStyle {
  /// A link-looking action in the accent, for Buttons and `Link`s alike.
  public static var accentLink: AccentLinkButtonStyle { AccentLinkButtonStyle() }
}
