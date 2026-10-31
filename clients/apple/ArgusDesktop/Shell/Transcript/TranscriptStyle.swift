import AppKit
import ArgusCore
import ArgusSyntax
import ArgusUI
import SwiftUI

/// Fonts, colours and attribute keys for transcript text. Colours are dynamic
/// `NSColor`s, so a rendered string stays right across a theme switch and the
/// render cache needn't key on appearance.
enum TranscriptStyle {
  static let bodySize: CGFloat = 13
  static let codeSize: CGFloat = 12

  static var body: NSFont { .systemFont(ofSize: TextScale.shared(bodySize)) }
  static var code: NSFont { .monospacedSystemFont(ofSize: TextScale.shared(codeSize), weight: .regular) }

  static let text = NSColor.labelColor
  static let secondary = NSColor.secondaryLabelColor
  static let muted = NSColor.tertiaryLabelColor
  static let codeBackground = NSColor.quaternarySystemFill
  static let inlineCodeBackground = NSColor.quaternarySystemFill
  static let rule = NSColor.separatorColor
  static let error = dynamic(light: Theme.light.error, dark: Theme.dark.error)

  static let accent = themed { accent, _, _ in accent }
  /// Links underline softly and in full on hover, as on the desktop.
  static let linkUnderline = themed { accent, _, _ in accent.opacity(0.45) }

  /// A fenced block: a scrim under the text and a hairline round it, as on the desktop.
  static let codeBlockBackground = dynamic(light: Theme.light.mediaBg.opacity(0.045), dark: Theme.dark.mediaBg.opacity(0.32))
  static let codeBlockBorder = NSColor.separatorColor
  /// Fenced code's colours, the shared syntax palette per appearance.
  static let syntax: [SyntaxCapture: NSColor] = Dictionary(
    uniqueKeysWithValues: SyntaxCapture.allCases.map {
      ($0, dynamic(light: SyntaxPalette.light.color($0), dark: SyntaxPalette.dark.color($0)))
    })
  static let inserted = dynamic(light: Theme.light.success, dark: Theme.dark.success)
  static let matchBackground = themed { accent, scheme, muted in
    accent.opacity(muted ? 0.16 : scheme == .light ? 0.22 : 0.25)
  }
  /// Strong enough to find at a glance, light enough to keep the text readable;
  /// a monochrome accent under same-coloured text has to stay fainter.
  static let currentMatchBackground = themed { accent, scheme, muted in
    accent.opacity(muted ? 0.4 : scheme == .light ? 0.6 : 0.65)
  }

  /// The picked colour theme's accent, resolved at draw time.
  private static func themed(_ make: @escaping @Sendable (Color, ColorScheme, Bool) -> Color) -> NSColor {
    NSColor(name: nil) { appearance in
      let scheme: ColorScheme = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .dark : .light
      let colorTheme = ColorTheme.sanitize(UserDefaults.standard.string(forKey: AppPreferences.colorThemeKey))
      return NSColor(make(colorTheme.accent(for: scheme), scheme, colorTheme == .muted))
    }
  }

  private static func dynamic(light: Color, dark: Color) -> NSColor {
    let light = NSColor(light)
    let dark = NSColor(dark)
    return NSColor(name: nil) { appearance in
      appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
    }
  }

  static func paragraph(
    spacing: CGFloat = 8, indent: CGFloat = 0, tabStops: [CGFloat] = [], lineHeight: CGFloat = 1.2
  ) -> NSParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.paragraphSpacing = spacing
    style.headIndent = indent
    style.firstLineHeadIndent = tabStops.isEmpty ? indent : 0
    // Prose gets room between lines; tool output stays dense.
    style.lineHeightMultiple = lineHeight
    if !tabStops.isEmpty {
      style.tabStops = tabStops.map { NSTextTab(textAlignment: .left, location: $0) }
      style.defaultTabInterval = 0
    }
    return style
  }
}

extension NSAttributedString.Key {
  /// A paragraph drawn as a block — a code fence, quote, table or rule.
  static let transcriptBlock = NSAttributedString.Key("argus.transcriptBlock")
}

/// What a block paragraph draws behind its text.
enum TranscriptBlock: Int {
  case code
  case quote
  case rule
}

/// File links travel through the text view as URLs on a private scheme, so
/// they get NSTextView's link cursor and hit-testing for free.
enum TranscriptLink {
  static let scheme = "argus-file"

  static func url(for ref: FileLinks.FileRef) -> URL? {
    var components = URLComponents()
    components.scheme = scheme
    components.host = "open"
    components.queryItems =
      [URLQueryItem(name: "path", value: ref.path)]
      + (ref.line.map { [URLQueryItem(name: "line", value: String($0))] } ?? [])
      + (ref.column.map { [URLQueryItem(name: "col", value: String($0))] } ?? [])
    return components.url
  }

  static func fileRef(from url: URL) -> FileLinks.FileRef? {
    guard url.scheme == scheme,
      let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
      let path = items.first(where: { $0.name == "path" })?.value
    else { return nil }
    func int(_ name: String) -> Int? { items.first { $0.name == name }?.value.flatMap(Int.init) }
    return FileLinks.FileRef(path: path, line: int("line"), column: int("col"))
  }
}
