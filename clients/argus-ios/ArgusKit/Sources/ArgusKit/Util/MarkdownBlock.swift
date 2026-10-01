import Foundation

/// Block-level markdown structure. Inline formatting is left to
/// `AttributedString(markdown:)` at the render site — this only decides what
/// is a heading, a list, a fence, a table or a paragraph.
public enum MarkdownBlock: Equatable, Sendable {
  case heading(level: Int, text: String)
  case paragraph(String)
  case code(language: String?, body: String)
  case quote(String)
  case list(items: [String], ordered: Bool)
  case table(columns: [String], rows: [[String]])
  case rule

  /// `|---|:--:|` and friends — the row that turns pipes into a table.
  public static func isTableSeparator(_ line: String) -> Bool {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    guard trimmed.contains("-"), trimmed.hasPrefix("|") || trimmed.hasPrefix("-") else {
      return false
    }
    return trimmed.allSatisfy { "|-: \t".contains($0) }
  }

  public static func cells(_ line: String) -> [String] {
    var trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("|") { trimmed.removeFirst() }
    if trimmed.hasSuffix("|") { trimmed.removeLast() }
    return trimmed.components(separatedBy: "|").map {
      $0.trimmingCharacters(in: .whitespaces)
    }
  }

  public static func parse(_ source: String) -> [MarkdownBlock] {
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
    /// A blank line inside a list: the list goes on if an item or an indented
    /// continuation follows, and ends at anything else.
    var blankInList = false
    while let line = lines.first {
      lines = lines.dropFirst()

      if !listItems.isEmpty {
        let isBlank = line.trimmingCharacters(in: .whitespaces).isEmpty
        let indented = line.hasPrefix("  ") || line.hasPrefix("\t")
        if isBlank {
          blankInList = true
          continue
        }
        // An indented line under an item is that item's continuation.
        if indented, line.firstMatch(of: /^\s*([-*+]|\d+[.)])\s+/) == nil {
          let text = line.trimmingCharacters(in: .whitespaces)
          listItems[listItems.count - 1] += (blankInList ? "\n\n" : "\n") + text
          blankInList = false
          continue
        }
        let isItem = line.trimmingCharacters(in: .whitespaces)
          .firstMatch(of: /^([-*+]|\d+[.)])\s+/) != nil
        if blankInList, !isItem { flushList() }
        blankInList = false
      }

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

      // A pipe row is only a table when the next line is its separator;
      // otherwise it is ordinary text that happens to contain pipes.
      if trimmed.hasPrefix("|"), let next = lines.first,
        MarkdownBlock.isTableSeparator(next)
      {
        flushAll()
        let columns = MarkdownBlock.cells(trimmed)
        lines = lines.dropFirst()
        var rows: [[String]] = []
        while let row = lines.first,
          row.trimmingCharacters(in: .whitespaces).hasPrefix("|")
        {
          rows.append(MarkdownBlock.cells(row))
          lines = lines.dropFirst()
        }
        blocks.append(.table(columns: columns, rows: rows))
        continue
      }

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
