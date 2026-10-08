import ArgusSyntax
import SwiftUI

/// A read-only code viewer: line-virtualised, line numbers, syntax colours, horizontal scrolling
/// for long lines. Renders plain text at once and recolours when the off-main parse lands.
///
/// Set `focusLine` (1-based) to scroll to a line and tint it; changing it scrolls again.
public struct CodeView: View {
  @Environment(\.theme) private var theme
  let text: String
  let language: SyntaxLanguage?
  let focusLine: Int?
  let fontSize: CGFloat

  @State private var lines: [String] = []
  @State private var highlighted: [AttributedString]?
  @State private var disabledReason: SyntaxLimits.DisabledReason?
  @State private var longestLine = 0

  public init(text: String, language: SyntaxLanguage?, focusLine: Int? = nil, fontSize: CGFloat = 12) {
    self.text = text
    self.language = language
    self.focusLine = focusLine
    self.fontSize = fontSize
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let disabledReason {
        CodeViewNotice(reason: disabledReason)
      }
      ScrollViewReader { proxy in
        ScrollView([.vertical, .horizontal]) {
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(lines.indices, id: \.self) { index in
              row(index)
            }
          }
          .padding(.vertical, 6)
        }
        .onAppear { scroll(proxy, animated: false) }
        .onChange(of: focusLine) { scroll(proxy, animated: true) }
        .onChange(of: lines.count) { scroll(proxy, animated: false) }
      }
    }
    .background(theme.bg)
    .task(id: TaskKey(text: text, language: language, scheme: theme.scheme)) {
      await load()
    }
  }

  private func row(_ index: Int) -> some View {
    let number = index + 1
    let isFocused = number == focusLine
    return HStack(alignment: .firstTextBaseline, spacing: 0) {
      Text(verbatim: "\(number)")
        .font(.scaled(size: fontSize, design: .monospaced))
        .foregroundStyle(isFocused ? theme.text : theme.textMuted)
        .frame(width: gutterWidth, alignment: .trailing)
        .padding(.trailing, 12)
      line(index)
        .font(.scaled(size: fontSize, design: .monospaced))
        .textSelection(.enabled)
        .fixedSize(horizontal: true, vertical: false)
        .padding(.trailing, 16)
    }
    .frame(minWidth: contentWidth, alignment: .leading)
    .padding(.leading, 8)
    .background(isFocused ? theme.accentSoft : Color.clear)
    .id(number)
    .contextMenu {
      Button("Copy Line") { Clipboard.copy(lines[index]) }
      Button("Copy All") { Clipboard.copy(text) }
    }
  }

  @ViewBuilder
  private func line(_ index: Int) -> some View {
    if let highlighted, index < highlighted.count {
      Text(highlighted[index]).foregroundStyle(theme.syntax.variable)
    } else {
      Text(verbatim: lines[index]).foregroundStyle(theme.text)
    }
  }

  /// Wide enough for the longest line, so rows share one width and scrolling sideways is stable.
  private var contentWidth: CGFloat {
    gutterWidth + 36 + CGFloat(longestLine) * TextScale.shared(fontSize) * 0.62
  }

  private var gutterWidth: CGFloat {
    CGFloat(max(2, String(lines.count).count)) * TextScale.shared(fontSize) * 0.62
  }

  private func scroll(_ proxy: ScrollViewProxy, animated: Bool) {
    guard let focusLine, focusLine >= 1, focusLine <= lines.count else { return }
    if animated {
      withAnimation { proxy.scrollTo(focusLine, anchor: .center) }
    } else {
      proxy.scrollTo(focusLine, anchor: .center)
    }
  }

  private func load() async {
    let ranges = CodeBlockHighlighting.lineRanges(of: text as NSString)
    let ns = text as NSString
    lines = ranges.map { ns.substring(with: $0) }
    longestLine = ranges.lazy.map(\.length).max() ?? 0
    highlighted = nil
    disabledReason = SyntaxLimits.highlightingDisabledReason(byteCount: text.utf8.count, text: text)
    guard let language, disabledReason == nil else { return }
    let text = text
    let palette = theme.syntax
    let colored = await Task.detached(priority: .userInitiated) { () -> [AttributedString] in
      let runs = SyntaxHighlighter.highlight(text, language: language)
      return CodeBlockHighlighting.attributedLines(text, runs: runs, palette: palette)
    }.value
    guard !Task.isCancelled else { return }
    highlighted = colored
  }

  private struct TaskKey: Equatable {
    let text: String
    let language: SyntaxLanguage?
    let scheme: ColorScheme
  }
}

/// The one-line "highlighting is off" notice for minified or huge files.
private struct CodeViewNotice: View {
  @Environment(\.theme) private var theme
  let reason: SyntaxLimits.DisabledReason

  var body: some View {
    Text(message)
      .font(.scaled(.caption))
      .foregroundStyle(theme.textSecondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 10)
      .padding(.vertical, 6)
      .background(theme.bgSecondary)
  }

  private var message: String {
    switch reason {
    case .tooLarge: "Highlighting is off for files over 2 MB."
    case .longLines: "Highlighting is off for files with very long lines."
    }
  }
}

#Preview("Swift, focused line") {
  CodeView(
    text: """
      import SwiftUI

      /// A greeting.
      struct Greeter {
        let name: String
        func greet() -> String { "Hello, \\(name)!" }
      }
      """,
    language: .swift, focusLine: 5
  )
  .frame(width: 420, height: 240)
}

#Preview("Plain text, light") {
  CodeView(text: "No grammar for this one.\nSecond line.", language: nil)
    .environment(\.theme, .light)
    .frame(width: 320, height: 120)
}
