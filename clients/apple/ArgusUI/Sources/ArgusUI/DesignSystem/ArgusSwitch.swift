import SwiftUI

/// A switch tinted with the theme's `switchTint`. Apply to a Toggle, or to a
/// grouped `Form` whose toggles draw as switches anyway.
public struct ArgusSwitchStyle: ToggleStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    ArgusSwitch(configuration: configuration)
  }
}

private struct ArgusSwitch: View {
  @Environment(\.theme) private var theme
  let configuration: ToggleStyleConfiguration

  var body: some View {
    Toggle(configuration).toggleStyle(.switch).tint(theme.switchTint)
  }
}

extension ToggleStyle where Self == ArgusSwitchStyle {
  public static var argusSwitch: ArgusSwitchStyle { ArgusSwitchStyle() }
}
