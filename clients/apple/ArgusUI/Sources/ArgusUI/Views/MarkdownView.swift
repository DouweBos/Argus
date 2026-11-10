import ArgusCore
import ArgusKit
import SwiftUI

/// Markdown, rendered as SwiftUI text.
///
/// Block structure is split here; inline formatting and links go through
/// `AttributedString(markdown:)`, which already handles emphasis, code spans
/// and autolinks correctly — hand-rolling that again would only add bugs.
public struct MarkdownView: View {
  @Environment(\.theme) private var theme
  @Environment(\.openFileLink) private var openFileLink
  @Environment(\.linearMedia) private var linearMedia
  let text: String
  var baseSize: CGFloat = 15
  /// What a person typed: only `@paths` link as files, as on the Mac.
  var mentions = false

  public init(text: String, baseSize: CGFloat = 15, mentions: Bool = false) {
    self.text = text
    self.baseSize = baseSize
    self.mentions = mentions
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(Array(MarkdownBlock.parse(text).enumerated()), id: \.offset) { _, block in
        view(for: block)
      }
    }
    .modifier(FileLinkHandling())
  }

  @ViewBuilder
  private func view(for block: MarkdownBlock) -> some View {
    switch block {
    case .heading(let level, let text):
      inline(text)
        .font(.scaled(size: headingSize(level), weight: .bold))
        .padding(.top, 2)
    case .paragraph(let text):
      if linearMedia != nil, text.contains("uploads.linear.app") {
        VStack(alignment: .leading, spacing: 8) {
          ForEach(Array(LinearMediaLink.segments(text).enumerated()), id: \.offset) { _, segment in
            switch segment {
            case .text(let text): inline(text).font(.scaled(size: baseSize))
            case .media(let link): LinearMediaEmbed(link: link)
            }
          }
        }
      } else {
        inline(text).font(.scaled(size: baseSize))
      }
    case .code(let language, let body):
      CodeBlockView(language: language, code: body)
    case .quote(let text):
      HStack(alignment: .top, spacing: 8) {
        Rectangle().fill(theme.borderStrong).frame(width: 3)
        inline(text).font(.scaled(size: baseSize))
      }
      .fixedSize(horizontal: false, vertical: true)
    case .list(let items, let ordered):
      VStack(alignment: .leading, spacing: 4) {
        ForEach(Array(items.enumerated()), id: \.offset) { index, item in
          HStack(alignment: .top, spacing: 6) {
            Text(ordered ? "\(index + 1)." : "•")
              .font(.scaled(size: baseSize))
              .foregroundStyle(theme.textMuted)
            inline(item).font(.scaled(size: baseSize))
          }
        }
      }
    case .table(let columns, let rows):
      MarkdownTable(columns: columns, rows: rows, inline: inline)
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
    guard var attributed = try? AttributedString(markdown: source, options: options) else {
      return Text(source).foregroundColor(theme.text)
    }
    attributed = attributed.linkified(files: openFileLink != nil, mentions: mentions)
    // On the runs themselves: the text colour below would otherwise paint links like the rest.
    // Underlined too, since Muted's accent is the text colour.
    for run in attributed.runs where run.link != nil {
      attributed[run.range].foregroundColor = theme.accent
      attributed[run.range].underlineStyle = .single
    }
    return Text(attributed).foregroundColor(theme.text)
  }
}

/// A fenced code block, coloured by `ArgusSyntax` when the info string names a bundled
/// grammar; plain monospaced text until (or unless) that lands.
public struct CodeBlockView: View {
  @Environment(\.theme) private var theme
  let language: String?
  let code: String
  @State private var highlighted: AttributedString?

  public init(language: String? = nil, code: String) {
    self.language = language
    self.code = code
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let language, !language.isEmpty {
        Text(language)
          .font(.scaled(size: 10, weight: .semibold))
          .foregroundStyle(theme.textMuted)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
      }
      ScrollView(.horizontal, showsIndicators: false) {
        codeText
          .font(.scaled(size: 12, design: .monospaced))
          .foregroundStyle(theme.textSecondary)
          .padding(8)
          .fixedSize(horizontal: true, vertical: false)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(theme.bgTertiary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    .task(id: HighlightKey(code: code, language: language, scheme: theme.scheme)) {
      highlighted = await CodeBlockHighlighting.highlight(code, languageHint: language, theme: theme)
    }
  }

  private var codeText: Text {
    if let highlighted { Text(highlighted) } else { Text(code) }
  }

  private struct HighlightKey: Equatable {
    let code: String
    let language: String?
    let scheme: ColorScheme
  }
}

/// A markdown table. Scrolls sideways rather than wrapping cells into
/// unreadable slivers — a transcript column is narrow and tables rarely are.
private struct MarkdownTable: View {
  @Environment(\.theme) private var theme
  let columns: [String]
  let rows: [[String]]
  let inline: (String) -> Text

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      // Columns as wide as their content, as on the Mac; a long cell wraps rather than pushing the rest off screen.
      Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
        row(columns, isHeader: true)
        ForEach(Array(rows.enumerated()), id: \.offset) { _, cells in
          Divider().overlay(theme.borderSubtle)
          row(cells, isHeader: false)
        }
      }
      .padding(.vertical, 4)
    }
    .background(theme.bgTertiary.opacity(0.5))
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
  }

  private func row(_ cells: [String], isHeader: Bool) -> some View {
    GridRow(alignment: .top) {
      ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
        inline(cell)
          .font(.scaled(size: 13, weight: isHeader ? .semibold : .regular))
          .frame(maxWidth: 240, alignment: .leading)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 8)
          .padding(.vertical, 5)
      }
    }
  }
}

#Preview("Highlighted code block") {
  MarkdownView(text: "Run this:\n\n```ts\nconst answer: number = 42; // the answer\n```")
    .padding()
    .frame(width: 360)
}
