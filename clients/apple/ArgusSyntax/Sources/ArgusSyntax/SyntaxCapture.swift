import Foundation

/// The Argus highlight vocabulary. Every bundled query is rewritten to these names, and every
/// theme draws one colour per case.
public enum SyntaxCapture: String, CaseIterable, Sendable {
  case keyword, string, comment, type, function, number, constant, variable, property,
    `operator`, punctuation, tag, attribute, escape, regex, heading, link, emphasis, strong, code

  /// Resolves a query capture name, stripping dotted suffixes (`keyword.return` → `keyword`).
  /// Names outside the vocabulary stay unstyled.
  public static func resolve(_ captureName: String) -> SyntaxCapture? {
    var name = Substring(captureName)
    while true {
      if let capture = SyntaxCapture(rawValue: String(name)) { return capture }
      guard let dot = name.lastIndex(of: ".") else { return nil }
      name = name[..<dot]
    }
  }
}

/// A styled span of a document, in UTF-16 offsets (the unit `NSString` and LSP both use).
public struct SyntaxRun: Sendable, Equatable {
  public let range: NSRange
  public let capture: SyntaxCapture

  public init(range: NSRange, capture: SyntaxCapture) {
    self.range = range
    self.capture = capture
  }
}

/// Size guards: minified bundles and huge files open with highlighting off.
public enum SyntaxLimits {
  public enum DisabledReason: String, Sendable {
    case tooLarge = "too_large"
    case longLines = "long_lines"
  }

  public static let maxBytes = 2 * 1024 * 1024
  public static let maxLineLength = 20_000

  public static func highlightingDisabledReason(byteCount: Int, text: String) -> DisabledReason? {
    if byteCount > maxBytes { return .tooLarge }
    var lineLength = 0
    for unit in text.utf16 {
      if unit == 0x0A {
        lineLength = 0
      } else {
        lineLength += 1
        if lineLength > maxLineLength { return .longLines }
      }
    }
    return nil
  }
}
