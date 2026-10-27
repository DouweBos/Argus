import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// ⌘P / ⇧⌘O / ⌘T: open a file or jump to a symbol or line by fuzzy name, changed files first.
struct QuickOpenView: View {
  @Environment(\.theme) private var theme
  let code: CodeSession

  private var model: QuickOpenModel { code.quickOpen }

  var body: some View {
    @Bindable var model = model
    let results = model.results
    VStack(spacing: 0) {
      QuickOpenField(
        text: $model.text, placeholder: placeholder, fontSize: Self.fontSize,
        move: { model.move($0) }, submit: { model.submit() }, cancel: { model.dismiss() }
      )
      .padding(12)
      Divider()
      ScrollViewReader { proxy in
        List {
          if let message = message(for: results) {
            Text(message).foregroundStyle(.secondary)
          }
          ForEach(Array(results.enumerated()), id: \.element.id) { index, result in
            row(result, selected: index == model.selected)
              .id(index)
              .contentShape(Rectangle())
              .onTapGesture { model.open(result) }
              .clickable()
          }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .onChange(of: model.selected) { _, index in proxy.scrollTo(index) }
      }
      .frame(height: 340)
    }
    .frame(width: 600)
    .background(theme.surface, in: RoundedRectangle(cornerRadius: theme.radius))
    .overlay(RoundedRectangle(cornerRadius: theme.radius).strokeBorder(theme.border))
    .shadow(color: .black.opacity(theme.scheme == .dark ? 0.45 : 0.14), radius: 24, y: 10)
  }

  @ViewBuilder private func row(_ result: QuickOpenResult, selected: Bool) -> some View {
    switch result {
    case .file(let path, let indices, let boosted):
      QuickOpenFileRow(path: path, indices: indices, boosted: boosted)
        .listRowBackground(selected ? theme.selection : Color.clear)
    case .symbol(let symbol, let indices, _):
      QuickOpenSymbolRow(symbol: symbol, indices: indices)
        .listRowBackground(selected ? theme.selection : Color.clear)
    }
  }

  private var placeholder: String {
    switch model.base {
    case .files: "Open a file by name…"
    case .mixed: "Open Quickly: files and symbols…"
    }
  }

  /// The line above the rows: how to use the prefixes, or why there are none.
  private func message(for results: [QuickOpenResult]) -> String? {
    switch model.query {
    case .files(let text) where text.isEmpty:
      return "@ symbols in this file   # symbols in the workspace   : go to line"
    case .line(let line, _):
      guard model.activePath != nil else { return "Open a file to go to a line" }
      return line.map { "Press Return to go to line \($0)" } ?? "Type a line number, and a column after a colon"
    case .workspaceSymbols(let text) where text.isEmpty:
      return "Type the name of a class, function or other symbol"
    case .fileSymbols where model.activePath == nil:
      return "Open a file to list its symbols"
    default:
      guard results.isEmpty else { return nil }
      if code.fileListLoading || model.searching { return "Searching…" }
      return "No matches"
    }
  }

  @MainActor private static var fontSize: CGFloat {
    NSFont.preferredFont(forTextStyle: .title3).pointSize * AppPreferences.shared.textScale
  }
}

/// A file with its matched characters in bold, the changed ones marked.
private struct QuickOpenFileRow: View {
  @Environment(\.theme) private var theme
  let path: String
  let indices: [Int]
  let boosted: Bool

  var body: some View {
    let name = (path as NSString).lastPathComponent
    let nameStart = (path as NSString).length - (name as NSString).length
    HStack(spacing: 8) {
      FileTypeIcon(path: path).frame(width: 18)
      Text(QuickOpenHighlight.text(path, hits: indices, from: nameStart, to: nil, theme: theme))
      Text(QuickOpenHighlight.text(path, hits: indices, from: 0, to: max(0, nameStart - 1), theme: theme))
        .font(.scaled(.caption))
        .foregroundStyle(theme.textSecondary)
        .lineLimit(1)
        .truncationMode(.head)
      Spacer()
      if boosted {
        Text("Changed").font(.scaled(.caption)).foregroundStyle(theme.warning)
      }
    }
    .padding(.vertical, 3)
  }
}

/// A symbol: its kind, its name highlighted, then where it lives.
private struct QuickOpenSymbolRow: View {
  @Environment(\.theme) private var theme
  let symbol: ArgusProtocol.CodeSymbol
  let indices: [Int]

  var body: some View {
    HStack(spacing: 8) {
      SymbolKindBadge(kind: symbol.kind).frame(width: 18)
      Text(QuickOpenHighlight.text(symbol.name, hits: indices, from: 0, to: nil, theme: theme))
        .lineLimit(1)
      if let container = symbol.container {
        Text(container).font(.scaled(.caption)).foregroundStyle(theme.textSecondary).lineLimit(1)
      }
      Spacer(minLength: 8)
      Text("\(symbol.relativePath):\(symbol.line)")
        .font(.scaled(.caption))
        .foregroundStyle(theme.textMuted)
        .lineLimit(1)
        .truncationMode(.head)
    }
    .padding(.vertical, 3)
  }
}

/// Xcode's letter badges, in the completion list's colours.
struct SymbolKindBadge: View {
  @Environment(\.theme) private var theme
  let kind: ArgusProtocol.CodeSymbolKind

  var body: some View {
    Text(letter)
      .font(.system(size: 10, weight: .bold, design: .monospaced))
      .foregroundStyle(theme.onAccent)
      .frame(width: 16, height: 16)
      .background(tone.color(theme), in: RoundedRectangle(cornerRadius: 3))
      .accessibilityLabel(kind.rawValue.replacingOccurrences(of: "_", with: " "))
  }

  private var letter: String {
    switch kind {
    case .class: "C"
    case .struct: "S"
    case .enum: "E"
    case .enumMember: "e"
    case .protocol, .interface: "P"
    case .extension: "X"
    case .typeAlias: "T"
    case .module: "M"
    case .method, .constructor: "m"
    case .function: "f"
    case .property: "p"
    case .constant: "c"
    case .variable: "v"
    default: "·"
    }
  }

  private var tone: Tone {
    switch kind {
    case .method, .function, .constructor: .accent
    case .class, .struct, .enum, .protocol, .interface, .typeAlias, .extension: .success
    case .module: .warning
    default: .muted
    }
  }
}

/// `text`'s UTF-16 range `from..<to`, the matched characters in the accent colour.
enum QuickOpenHighlight {
  static func text(_ text: String, hits: [Int], from start: Int, to end: Int?, theme: Theme) -> AttributedString {
    let source = text as NSString
    let end = end ?? source.length
    let hits = Set(hits)
    var result = AttributedString()
    var index = start
    while index < end {
      let range = source.rangeOfComposedCharacterSequence(at: index)
      var piece = AttributedString(source.substring(with: range))
      if hits.contains(index) {
        piece.foregroundColor = theme.accent
        piece.inlinePresentationIntent = .stronglyEmphasized
      }
      result += piece
      index = range.location + range.length
    }
    return result
  }
}
