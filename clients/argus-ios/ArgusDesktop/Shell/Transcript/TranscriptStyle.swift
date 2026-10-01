import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// Fonts, colours and attribute keys for transcript text. Colours are dynamic
/// `NSColor`s, so a rendered string stays right across a theme switch and the
/// render cache needn't key on appearance.
enum TranscriptStyle {
  static let bodySize: CGFloat = 13
  static let codeSize: CGFloat = 12

  nonisolated(unsafe) static let body = NSFont.systemFont(ofSize: bodySize)
  nonisolated(unsafe) static let code = NSFont.monospacedSystemFont(ofSize: codeSize, weight: .regular)

  static let text = NSColor.labelColor
  static let secondary = NSColor.secondaryLabelColor
  static let muted = NSColor.tertiaryLabelColor
  static let codeBackground = NSColor.quaternarySystemFill
  static let inlineCodeBackground = NSColor.quaternarySystemFill
  static let rule = NSColor.separatorColor
  static let error = dynamic(light: Theme.light.error, dark: Theme.dark.error)

  static let accent = dynamic(light: Theme.light.accent, dark: Theme.dark.accent)
  static let matchBackground = dynamic(
    light: Theme.light.accent.opacity(0.22), dark: Theme.dark.accent.opacity(0.25))
  /// Strong enough to find at a glance, light enough to keep the text readable.
  static let currentMatchBackground = dynamic(
    light: Theme.light.accent.opacity(0.6), dark: Theme.dark.accent.opacity(0.65))

  private static func dynamic(light: Color, dark: Color) -> NSColor {
    let light = NSColor(light)
    let dark = NSColor(dark)
    return NSColor(name: nil) { appearance in
      appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
    }
  }

  static func paragraph(
    spacing: CGFloat = 6, indent: CGFloat = 0, tabStops: [CGFloat] = []
  ) -> NSParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.paragraphSpacing = spacing
    style.headIndent = indent
    style.firstLineHeadIndent = tabStops.isEmpty ? indent : 0
    style.lineHeightMultiple = 1.08
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
