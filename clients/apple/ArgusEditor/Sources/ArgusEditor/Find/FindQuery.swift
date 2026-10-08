import Foundation

/// A find-in-file query, compiled to one regular expression whatever the options.
public struct FindQuery: Equatable, Sendable {
  public var text: String
  public var isRegex: Bool
  public var isCaseSensitive: Bool
  public var isWholeWord: Bool

  public init(text: String, isRegex: Bool = false, isCaseSensitive: Bool = false, isWholeWord: Bool = false) {
    self.text = text
    self.isRegex = isRegex
    self.isCaseSensitive = isCaseSensitive
    self.isWholeWord = isWholeWord
  }

  public enum Failure: Error, Equatable {
    case invalidPattern(String)
  }

  func expression() throws -> NSRegularExpression? {
    guard !text.isEmpty else { return nil }
    var pattern = isRegex ? text : NSRegularExpression.escapedPattern(for: text)
    if isWholeWord { pattern = "(?<![\\p{L}\\p{N}_])(?:\(pattern))(?![\\p{L}\\p{N}_])" }
    var options: NSRegularExpression.Options = [.anchorsMatchLines]
    if !isCaseSensitive { options.insert(.caseInsensitive) }
    do {
      return try NSRegularExpression(pattern: pattern, options: options)
    } catch {
      throw Failure.invalidPattern(text)
    }
  }

  /// Every match, in document order. Empty matches (`^`, `a*`) are skipped: they can't be highlighted or stepped through.
  public func matches(in text: NSString, limit: Int = 20_000) throws -> [NSRange] {
    guard let expression = try expression() else { return [] }
    var ranges: [NSRange] = []
    expression.enumerateMatches(in: text as String, range: NSRange(location: 0, length: text.length)) { match, _, stop in
      guard let match, match.range.length > 0 else { return }
      ranges.append(match.range)
      if ranges.count >= limit { stop.pointee = true }
    }
    return ranges
  }

  /// The replacement for one match; regex queries expand `$1`-style templates.
  public func replacement(for match: NSRange, in text: NSString, template: String) throws -> String {
    guard isRegex, let expression = try expression(),
      let result = expression.firstMatch(in: text as String, options: [.anchored], range: match)
    else { return template }
    return expression.replacementString(for: result, in: text as String, offset: 0, template: template)
  }
}
