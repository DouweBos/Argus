import AppKit
import ArgusCore
import ArgusSyntax
import ArgusUI

/// Transcript text as one attributed string per message, so a single TextKit 2
/// view can select, copy, search and link across the whole message.
///
/// Block structure comes from the same `MarkdownBlock` parser iOS uses; inline
/// formatting from `AttributedString(markdown:)`. A code fence is one paragraph
/// joined by line separators, so it lays out as one fragment and draws one box.
enum TranscriptMarkdown {
  static let lineSeparator = "\u{2028}"

  static func render(markdown source: String) -> TranscriptRendered {
    var parts: [TranscriptRendered.Part] = []
    var prose = NSMutableAttributedString()
    func flush() {
      guard prose.length > 0 else { return }
      linkify(prose, mentions: false)
      parts.append(.prose(prose))
      prose = NSMutableAttributedString()
    }
    for block in MarkdownBlock.parse(source) {
      if case .code(let language, let body) = block {
        flush()
        parts.append(.code(language: language.flatMap { $0.isEmpty ? nil : $0 }, text: code(body, language: language)))
        continue
      }
      if prose.length > 0 { prose.append(NSAttributedString(string: "\n")) }
      prose.append(render(block))
    }
    flush()
    return TranscriptRendered(parts: parts)
  }

  /// What the user typed, verbatim: markdown in a prompt is usually literal.
  static func render(userText: String) -> TranscriptRendered {
    let out = NSMutableAttributedString(
      string: userText,
      attributes: [.font: TranscriptStyle.body, .foregroundColor: TranscriptStyle.text,
                   .paragraphStyle: TranscriptStyle.paragraph()])
    linkify(out, mentions: true)
    return TranscriptRendered(parts: [.prose(out)])
  }

  /// A fenced block's body, highlighted for its language and never wrapped.
  static func code(_ body: String, language: String?) -> NSAttributedString {
    let style = NSMutableParagraphStyle()
    style.lineHeightMultiple = 1.08
    let out = NSMutableAttributedString(
      string: body.hasSuffix("\n") ? String(body.dropLast()) : body,
      attributes: [.font: TranscriptStyle.code, .foregroundColor: TranscriptStyle.secondary, .paragraphStyle: style])
    highlight(out, language: language)
    linkify(out, mentions: false)
    return out
  }

  /// The shared tree-sitter highlighter's runs as colours; a diff, which has no
  /// grammar, gets its added and removed lines marked.
  private static func highlight(_ code: NSMutableAttributedString, language: String?) {
    guard let language else { return }
    if let syntax = SyntaxLanguage(languageName: language) {
      guard let runs = CodeBlockHighlighting.runsNow(for: code.string, language: syntax) else { return }
      let bold = NSFont.monospacedSystemFont(ofSize: TranscriptStyle.code.pointSize, weight: .bold)
      for run in runs where NSMaxRange(run.range) <= code.length {
        code.addAttribute(
          .foregroundColor, value: TranscriptStyle.syntax[run.capture] ?? TranscriptStyle.secondary, range: run.range)
        if run.capture.isBold { code.addAttribute(.font, value: bold, range: run.range) }
      }
    } else if ["diff", "patch"].contains(language.lowercased()) {
      let text = code.string as NSString
      for line in CodeBlockHighlighting.lineRanges(of: text) where line.length > 0 {
        let head = text.substring(with: line)
        let color: NSColor? =
          head.hasPrefix("@@") ? TranscriptStyle.syntax[.keyword]
          : head.hasPrefix("+++") || head.hasPrefix("---") ? TranscriptStyle.muted
          : head.hasPrefix("+") ? TranscriptStyle.inserted
          : head.hasPrefix("-") ? TranscriptStyle.error : nil
        if let color { code.addAttribute(.foregroundColor, value: color, range: line) }
      }
    }
  }

  /// Tool output and commands: monospaced, linkified, no markdown.
  static func render(plain text: String, color: NSColor = TranscriptStyle.secondary) -> NSAttributedString {
    let out = NSMutableAttributedString(
      string: text,
      attributes: [.font: TranscriptStyle.code, .foregroundColor: color,
                   .paragraphStyle: TranscriptStyle.paragraph(spacing: 0, lineHeight: 1.08)])
    linkify(out, mentions: false)
    return out
  }

  // MARK: Blocks

  private static func render(_ block: MarkdownBlock) -> NSAttributedString {
    switch block {
    case .heading(let level, let text):
      let size: CGFloat = level == 1 ? 17 : level == 2 ? 15 : 13
      return inline(text, font: .systemFont(ofSize: size, weight: .bold), spacing: 6)
    case .paragraph(let text):
      return inline(text, font: TranscriptStyle.body)
    case .code(_, let body):
      // Split out by `render(markdown:)`; a fence never reaches here.
      return NSAttributedString(string: body)
    case .quote(let text):
      let out = NSMutableAttributedString(attributedString: inline(text, font: TranscriptStyle.body, indent: 12))
      out.addAttributes(
        [.transcriptBlock: TranscriptBlock.quote.rawValue, .foregroundColor: TranscriptStyle.secondary],
        range: NSRange(location: 0, length: out.length))
      return out
    case .list(let items, let ordered):
      let out = NSMutableAttributedString()
      for (index, item) in items.enumerated() {
        if index > 0 { out.append(NSAttributedString(string: "\n")) }
        let marker = ordered ? "\(index + 1)." : "•"
        let line = NSMutableAttributedString(
          string: "\(marker)\t",
          attributes: [.font: TranscriptStyle.body, .foregroundColor: TranscriptStyle.secondary])
        line.append(inline(item, font: TranscriptStyle.body))
        line.addAttribute(
          .paragraphStyle,
          value: TranscriptStyle.paragraph(
            spacing: index == items.count - 1 ? 6 : 2, indent: 18, tabStops: [18]),
          range: NSRange(location: 0, length: line.length))
        out.append(line)
      }
      return out
    case .table(let columns, let rows):
      return table(columns: columns, rows: rows)
    case .rule:
      return NSAttributedString(
        string: "\u{00A0}",
        attributes: [.transcriptBlock: TranscriptBlock.rule.rawValue, .font: TranscriptStyle.body,
                     .paragraphStyle: TranscriptStyle.paragraph()])
    }
  }

  /// Columns on tab stops sized to their widest cell, so a table reads as one
  /// while staying plain, selectable text.
  private static func table(columns: [String], rows: [[String]]) -> NSAttributedString {
    let header = columns.map { inline($0, font: .systemFont(ofSize: TextScale.shared(TranscriptStyle.bodySize), weight: .semibold)) }
    let body = rows.map { $0.map { inline($0, font: TranscriptStyle.body) } }
    let all = [header] + body
    let count = all.map(\.count).max() ?? 0
    var stops: [CGFloat] = []
    var x: CGFloat = 10
    for column in 0..<count {
      if column > 0 { stops.append(x) }
      let widest = all.compactMap { $0.indices.contains(column) ? $0[column].size().width : nil }.max() ?? 0
      x += min(widest, 280) + 18
    }
    let style = NSMutableParagraphStyle()
    style.tabStops = stops.map { NSTextTab(textAlignment: .left, location: $0) }
    style.headIndent = 10
    style.firstLineHeadIndent = 10
    style.paragraphSpacingBefore = 10
    style.paragraphSpacing = 14
    style.lineSpacing = 3

    let out = NSMutableAttributedString()
    for (index, cells) in all.enumerated() {
      if index > 0 { out.append(NSAttributedString(string: lineSeparator)) }
      for (column, cell) in cells.enumerated() {
        if column > 0 { out.append(NSAttributedString(string: "\t")) }
        out.append(cell)
      }
    }
    out.addAttributes(
      [.paragraphStyle: style, .transcriptBlock: TranscriptBlock.code.rawValue],
      range: NSRange(location: 0, length: out.length))
    return out
  }

  // MARK: Inline

  private static func inline(
    _ source: String, font: NSFont, spacing: CGFloat = 6, indent: CGFloat = 0
  ) -> NSAttributedString {
    var options = AttributedString.MarkdownParsingOptions()
    options.interpretedSyntax = .inlineOnlyPreservingWhitespace
    let base: [NSAttributedString.Key: Any] = [
      .font: font, .foregroundColor: TranscriptStyle.text,
      .paragraphStyle: TranscriptStyle.paragraph(spacing: spacing, indent: indent),
    ]
    guard let parsed = try? AttributedString(markdown: source, options: options) else {
      return NSAttributedString(string: source, attributes: base)
    }
    let out = NSMutableAttributedString()
    for run in parsed.runs {
      var attributes = base
      let intent = run.inlinePresentationIntent ?? []
      var traits: NSFontDescriptor.SymbolicTraits = []
      if intent.contains(.stronglyEmphasized) { traits.insert(.bold) }
      if intent.contains(.emphasized) { traits.insert(.italic) }
      if intent.contains(.code) {
        attributes[.font] = NSFont.monospacedSystemFont(ofSize: font.pointSize - 1, weight: .regular)
        attributes[.backgroundColor] = TranscriptStyle.inlineCodeBackground
        attributes[.foregroundColor] = TranscriptStyle.accent
      } else if !traits.isEmpty {
        let descriptor = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(traits))
        attributes[.font] = NSFont(descriptor: descriptor, size: font.pointSize) ?? font
      }
      if intent.contains(.strikethrough) {
        attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
      }
      if let link = run.link { attributes[.link] = link }
      out.append(NSAttributedString(string: String(parsed[run.range].characters), attributes: attributes))
    }
    return out
  }

  /// Paths and bare URLs become links, except where markdown already made one.
  private static func linkify(_ string: NSMutableAttributedString, mentions: Bool) {
    let text = string.string
    let matches = mentions ? FileLinks.mentionMatches(in: text) : FileLinks.matches(in: text)
    for match in matches {
      var linked = false
      string.enumerateAttribute(.link, in: match.range) { value, _, stop in
        if value != nil { linked = true; stop.pointee = true }
      }
      guard !linked else { continue }
      let url: URL? =
        switch match.kind {
        case .file(let ref): TranscriptLink.url(for: ref)
        case .url(let raw): URL(string: raw)
        }
      if let url { string.addAttribute(.link, value: url, range: match.range) }
    }
  }
}

/// A message's text as the transcript lays it out: prose runs, and fenced code
/// in blocks of its own that scroll sideways. `string` is all of it joined by
/// newlines, the space find and selection count in.
final class TranscriptRendered {
  enum Part {
    case prose(NSAttributedString)
    case code(language: String?, text: NSAttributedString)

    var text: NSAttributedString {
      switch self {
      case .prose(let text), .code(_, let text): text
      }
    }
  }

  let parts: [Part]
  /// Where each part starts in `string`.
  let offsets: [Int]
  let string: String

  init(parts: [Part]) {
    self.parts = parts
    var offsets: [Int] = []
    var offset = 0
    for part in parts {
      offsets.append(offset)
      offset += part.text.length + 1
    }
    self.offsets = offsets
    string = parts.map(\.text.string).joined(separator: "\n")
  }

  var length: Int { (string as NSString).length }
}
