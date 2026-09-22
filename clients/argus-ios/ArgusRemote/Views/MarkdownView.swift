import SwiftUI

/// Markdown, rendered as SwiftUI text.
///
/// Block structure is split here; inline formatting and links go through
/// `AttributedString(markdown:)`, which already handles emphasis, code spans
/// and autolinks correctly — hand-rolling that again would only add bugs.
struct MarkdownView: View {
  @Environment(\.theme) private var theme
  let text: String
  var baseSize: CGFloat = 15

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(Array(MarkdownBlock.parse(text).enumerated()), id: \.offset) { _, block in
        view(for: block)
      }
    }
  }

  @ViewBuilder
  private func view(for block: MarkdownBlock) -> some View {
    switch block {
    case .heading(let level, let text):
      inline(text)
        .font(.system(size: headingSize(level), weight: .bold))
        .padding(.top, 2)
    case .paragraph(let text):
      inline(text).font(.system(size: baseSize))
    case .code(let language, let body):
      CodeBlockView(language: language, code: body)
    case .quote(let text):
      HStack(alignment: .top, spacing: 8) {
        Rectangle().fill(theme.borderStrong).frame(width: 3)
        inline(text).font(.system(size: baseSize))
      }
      .fixedSize(horizontal: false, vertical: true)
    case .list(let items, let ordered):
      VStack(alignment: .leading, spacing: 4) {
        ForEach(Array(items.enumerated()), id: \.offset) { index, item in
          HStack(alignment: .top, spacing: 6) {
            Text(ordered ? "\(index + 1)." : "•")
              .font(.system(size: baseSize))
              .foregroundStyle(theme.textMuted)
            inline(item).font(.system(size: baseSize))
          }
        }
      }
    case .rule:
      Rectangle().fill(theme.border).frame(height: 1)
    }
  }

  private func headingSize(_ level: Int) -> CGFloat {
    switch level {
    case 1: 19
    case 2: 17
    default: 15
    }
  }

  private func inline(_ source: String) -> Text {
    var options = AttributedString.MarkdownParsingOptions()
    options.interpretedSyntax = .inlineOnlyPreservingWhitespace
    guard let attributed = try? AttributedString(markdown: source, options: options) else {
      return Text(source).foregroundColor(theme.text)
    }
    return Text(attributed).foregroundColor(theme.text)
  }
}

struct CodeBlockView: View {
  @Environment(\.theme) private var theme
  let language: String?
  let code: String

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let language, !language.isEmpty {
        Text(language)
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(theme.textMuted)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
      }
      ScrollView(.horizontal, showsIndicators: false) {
        Text(code)
          .font(.system(size: 12, design: .monospaced))
          .foregroundStyle(theme.textSecondary)
          .padding(8)
          .fixedSize(horizontal: true, vertical: false)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(theme.bgTertiary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
  }
}

enum MarkdownBlock {
  case heading(level: Int, text: String)
  case paragraph(String)
  case code(language: String?, body: String)
  case quote(String)
  case list(items: [String], ordered: Bool)
  case rule

  static func parse(_ source: String) -> [MarkdownBlock] {
    var blocks: [MarkdownBlock] = []
    var paragraph: [String] = []
    var listItems: [String] = []
    var listOrdered = false
    var quote: [String] = []

    func flushParagraph() {
      guard !paragraph.isEmpty else { return }
      blocks.append(.paragraph(paragraph.joined(separator: "\n")))
      paragraph = []
    }
    func flushList() {
      guard !listItems.isEmpty else { return }
      blocks.append(.list(items: listItems, ordered: listOrdered))
      listItems = []
    }
    func flushQuote() {
      guard !quote.isEmpty else { return }
      blocks.append(.quote(quote.joined(separator: "\n")))
      quote = []
    }
    func flushAll() {
      flushParagraph()
      flushList()
      flushQuote()
    }

    var lines = source.components(separatedBy: "\n")[...]
    while let line = lines.first {
      lines = lines.dropFirst()

      if line.hasPrefix("```") {
        flushAll()
        let language = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
        var body: [String] = []
        while let next = lines.first, !next.hasPrefix("```") {
          body.append(next)
          lines = lines.dropFirst()
        }
        // Drop the closing fence, if the block was actually closed.
        if lines.first?.hasPrefix("```") == true { lines = lines.dropFirst() }
        blocks.append(
          .code(language: language.isEmpty ? nil : language, body: body.joined(separator: "\n")))
        continue
      }

      let trimmed = line.trimmingCharacters(in: .whitespaces)

      if trimmed.isEmpty {
        flushAll()
        continue
      }
      if trimmed == "---" || trimmed == "***" || trimmed == "___" {
        flushAll()
        blocks.append(.rule)
        continue
      }
      if let match = trimmed.firstMatch(of: /^(#{1,6})\s+(.*)$/) {
        flushAll()
        blocks.append(
          .heading(level: match.1.count, text: String(match.2)))
        continue
      }
      if trimmed.hasPrefix("> ") {
        flushParagraph()
        flushList()
        quote.append(String(trimmed.dropFirst(2)))
        continue
      }
      if let match = trimmed.firstMatch(of: /^[-*+]\s+(.*)$/) {
        flushParagraph()
        flushQuote()
        if !listItems.isEmpty && listOrdered { flushList() }
        listOrdered = false
        listItems.append(String(match.1))
        continue
      }
      if let match = trimmed.firstMatch(of: /^\d+[.)]\s+(.*)$/) {
        flushParagraph()
        flushQuote()
        if !listItems.isEmpty && !listOrdered { flushList() }
        listOrdered = true
        listItems.append(String(match.1))
        continue
      }

      flushList()
      flushQuote()
      paragraph.append(line)
    }
    flushAll()
    return blocks
  }
}
