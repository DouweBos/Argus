import ArgusCore
import Foundation

/// The viewport sizes the embedded browser can emulate: the renderer's
/// `browserPresets.ts`, plus a project's own from `.argus.json`.
struct BrowserPreset: Identifiable, Equatable {
  var id: String
  var label: String
  var width: Double
  var height: Double
  var mobile: Bool
  var userAgent: String

  static let defaultUserAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

  static let builtIn: [BrowserPreset] = [
    BrowserPreset(
      id: "desktop", label: "Desktop", width: 1440, height: 900, mobile: false,
      userAgent: defaultUserAgent),
    BrowserPreset(
      id: "tablet", label: "Tablet", width: 768, height: 1024, mobile: true,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    ),
    BrowserPreset(
      id: "mobile", label: "Mobile", width: 375, height: 667, mobile: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    ),
  ]

  /// A project preset; portrait ones are treated as mobile, as on the desktop.
  init(_ config: ArgusProtocol.BrowserPresetConfig) {
    self.init(
      id: config.id, label: config.label ?? config.id, width: config.width,
      height: config.height, mobile: config.height > config.width,
      userAgent: config.userAgent ?? Self.defaultUserAgent)
  }

  init(id: String, label: String, width: Double, height: Double, mobile: Bool, userAgent: String) {
    self.id = id
    self.label = label
    self.width = width
    self.height = height
    self.mobile = mobile
    self.userAgent = userAgent
  }

  /// Custom presets whose id doesn't shadow a built-in.
  static func custom(_ configs: [ArgusProtocol.BrowserPresetConfig]) -> [BrowserPreset] {
    configs.filter { config in !builtIn.contains { $0.id == config.id } }.map(BrowserPreset.init)
  }

  /// Built-ins first, then the project's; unknown ids fall back to desktop.
  static func resolve(_ id: String, custom: [BrowserPreset]) -> BrowserPreset {
    builtIn.first { $0.id == id } ?? custom.first { $0.id == id } ?? builtIn[0]
  }

  var wire: ArgusProtocol.BrowserPreset {
    ArgusProtocol.BrowserPreset(
      internalHeight: height, internalWidth: width,
      screenPosition: mobile ? .mobile : .desktop, userAgent: userAgent)
  }

  /// The renderer's `normalizeUrl`: a bare host gets a scheme.
  static func normalize(_ raw: String) -> String {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "" }
    let lower = trimmed.lowercased()
    if lower.hasPrefix("http://") || lower.hasPrefix("https://") { return trimmed }
    if lower.hasPrefix("localhost") { return "http://\(trimmed)" }
    return "https://\(trimmed)"
  }
}
