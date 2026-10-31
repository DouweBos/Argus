import ArgusSyntax
import Foundation
import Synchronization
import SwiftUI

/// Turns code into coloured `AttributedString`s for chat code blocks and `CodeView`.
/// Parsing happens off the main actor; colouring is cheap and done per theme.
public enum CodeBlockHighlighting {
  /// Highlights `code` as the language a fence info string or hint names. Nil when the hint
  /// names no bundled grammar or the code is too big to colour: show it plain.
  public static func highlight(_ code: String, languageHint: String?, theme: Theme) async
    -> AttributedString?
  {
    guard let language = languageHint.flatMap(SyntaxLanguage.init(languageName:)) else {
      return nil
    }
    let runs = await runs(for: code, language: language)
    guard let runs else { return nil }
    return attributed(code, runs: runs, palette: theme.syntax)
  }

  /// Syntax runs for `code`, parsed off the main actor and memoised (chat re-renders the same
  /// blocks constantly). Nil when `SyntaxLimits` turns highlighting off.
  public static func runs(for code: String, language: SyntaxLanguage) async -> [SyntaxRun]? {
    let key = CacheKey(code: code, language: language)
    if let cached = cache.withLock({ $0[key] }) { return cached }
    let runs = await Task.detached(priority: .userInitiated) { parse(code, language: language) }.value
    remember(runs, for: key)
    return runs
  }

  /// `runs(for:language:)` parsed on the caller, for layout that can't wait (the Mac
  /// transcript renders a message's text synchronously). Same cache and limits.
  public static func runsNow(for code: String, language: SyntaxLanguage) -> [SyntaxRun]? {
    let key = CacheKey(code: code, language: language)
    if let cached = cache.withLock({ $0[key] }) { return cached }
    let runs = parse(code, language: language)
    remember(runs, for: key)
    return runs
  }

  private static func parse(_ code: String, language: SyntaxLanguage) -> [SyntaxRun]? {
    guard SyntaxLimits.highlightingDisabledReason(byteCount: code.utf8.count, text: code) == nil
    else { return nil }
    return SyntaxHighlighter.highlight(code, language: language)
  }

  private static func remember(_ runs: [SyntaxRun]?, for key: CacheKey) {
    guard key.code.utf16.count <= maxCachedLength else { return }
    cache.withLock { cache in
      if cache.count >= maxCacheEntries { cache.removeAll(keepingCapacity: true) }
      cache[key] = runs
    }
  }

  /// The whole of `code` as one coloured string.
  public static func attributed(_ code: String, runs: [SyntaxRun], palette: SyntaxPalette)
    -> AttributedString
  {
    let ns = code as NSString
    return styled(ns, range: NSRange(location: 0, length: ns.length), runs: runs[...], palette: palette)
  }

  /// One coloured string per line (without its newline), for line-virtualised views.
  public static func attributedLines(_ code: String, runs: [SyntaxRun], palette: SyntaxPalette)
    -> [AttributedString]
  {
    let ns = code as NSString
    var lines: [AttributedString] = []
    var runIndex = runs.startIndex
    for line in lineRanges(of: ns) {
      while runIndex < runs.endIndex, NSMaxRange(runs[runIndex].range) <= line.location {
        runIndex += 1
      }
      var end = runIndex
      while end < runs.endIndex, runs[end].range.location < NSMaxRange(line) { end += 1 }
      lines.append(styled(ns, range: line, runs: runs[runIndex..<end], palette: palette))
    }
    return lines
  }

  /// UTF-16 ranges of each line of `text`, excluding the line break.
  public static func lineRanges(of text: NSString) -> [NSRange] {
    var ranges: [NSRange] = []
    var start = 0
    let length = text.length
    for index in 0..<length where text.character(at: index) == 0x0A {
      let end = index > start && text.character(at: index - 1) == 0x0D ? index - 1 : index
      ranges.append(NSRange(location: start, length: end - start))
      start = index + 1
    }
    ranges.append(NSRange(location: start, length: length - start))
    return ranges
  }

  private static func styled(
    _ text: NSString, range: NSRange, runs: ArraySlice<SyntaxRun>, palette: SyntaxPalette
  ) -> AttributedString {
    var result = AttributedString()
    var cursor = range.location
    let end = NSMaxRange(range)
    for run in runs {
      let lower = max(run.range.location, cursor)
      let upper = min(NSMaxRange(run.range), end)
      guard lower < upper else { continue }
      if lower > cursor {
        result += AttributedString(text.substring(with: NSRange(location: cursor, length: lower - cursor)))
      }
      var piece = AttributedString(text.substring(with: NSRange(location: lower, length: upper - lower)))
      piece.foregroundColor = palette.color(run.capture)
      if run.capture.isBold { piece.inlinePresentationIntent = .stronglyEmphasized }
      if run.capture.isItalic { piece.inlinePresentationIntent = .emphasized }
      result += piece
      cursor = upper
    }
    if cursor < end {
      result += AttributedString(text.substring(with: NSRange(location: cursor, length: end - cursor)))
    }
    return result
  }

  private struct CacheKey: Hashable {
    let code: String
    let language: SyntaxLanguage
  }

  private static let maxCacheEntries = 256
  private static let maxCachedLength = 64 * 1024
  private static let cache = Mutex<[CacheKey: [SyntaxRun]?]>([:])
}
