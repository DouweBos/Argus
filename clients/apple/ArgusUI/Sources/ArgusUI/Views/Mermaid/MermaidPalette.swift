import SwiftUI

/// The theme's tokens as Mermaid `base` theme variables, so a diagram is drawn
/// in the app's own colours in either scheme. Opaque hex only: Mermaid derives
/// shades from these and can't from a translucent colour.
public struct MermaidPalette: Hashable, Sendable {
  public let variables: [String: String]

  public init(theme: Theme) {
    let canvas = theme.bgSecondary
    var environment = EnvironmentValues()
    environment.colorScheme = theme.scheme
    func hex(_ color: Color) -> String { Self.hex(color, over: canvas, in: environment) }
    let node = hex(theme.bgTertiary)
    let border = hex(theme.borderStrong)
    let text = hex(theme.text)
    let muted = hex(theme.textSecondary)
    let accent = hex(theme.accentSoft)
    variables = [
      "darkMode": theme.scheme == .dark ? "true" : "false",
      "background": hex(canvas),
      "fontSize": "14px",
      "primaryColor": node,
      "primaryBorderColor": border,
      "primaryTextColor": text,
      "secondaryColor": accent,
      "secondaryBorderColor": hex(theme.accentBorder),
      "secondaryTextColor": text,
      "tertiaryColor": hex(theme.bg),
      "tertiaryBorderColor": hex(theme.border),
      "tertiaryTextColor": text,
      "lineColor": muted,
      "textColor": text,
      "mainBkg": node,
      "nodeBorder": border,
      "clusterBkg": hex(theme.bg),
      "clusterBorder": hex(theme.border),
      "titleColor": text,
      "edgeLabelBackground": hex(canvas),
      "noteBkgColor": hex(theme.warningSoft),
      "noteBorderColor": hex(theme.warning),
      "noteTextColor": text,
      "actorBkg": node,
      "actorBorder": border,
      "actorTextColor": text,
      "actorLineColor": muted,
      "signalColor": muted,
      "signalTextColor": text,
      "labelBoxBkgColor": node,
      "labelBoxBorderColor": border,
      "labelTextColor": text,
      "loopTextColor": text,
      "activationBkgColor": accent,
      "activationBorderColor": border,
      "sequenceNumberColor": hex(theme.onAccent),
      "errorBkgColor": hex(theme.errorSoft),
      "errorTextColor": hex(theme.error),
    ]
  }

  public static let dark = MermaidPalette(theme: .dark)
  public static let light = MermaidPalette(theme: .light)

  /// `#rrggbb`, a translucent colour composited over `background` first.
  static func hex(_ color: Color, over background: Color, in environment: EnvironmentValues) -> String {
    let top = components(color, environment)
    let bottom = components(background, environment)
    let alpha = top.alpha
    let mixed = (0..<3).map { top.rgb[$0] * alpha + bottom.rgb[$0] * (1 - alpha) }
    return "#" + mixed.map { String(format: "%02x", Int(($0 * 255).rounded()).clamped(0, 255)) }.joined()
  }

  private static func components(_ color: Color, _ environment: EnvironmentValues) -> (rgb: [Double], alpha: Double) {
    let resolved = color.resolve(in: environment)
    func srgb(_ linear: Float) -> Double {
      let value = Double(linear)
      return value <= 0.0031308 ? value * 12.92 : 1.055 * pow(value, 1 / 2.4) - 0.055
    }
    return ([srgb(resolved.linearRed), srgb(resolved.linearGreen), srgb(resolved.linearBlue)], Double(resolved.opacity))
  }
}

extension Int {
  fileprivate func clamped(_ low: Int, _ high: Int) -> Int { Swift.min(Swift.max(self, low), high) }
}
