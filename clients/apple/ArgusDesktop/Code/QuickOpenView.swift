import ArgusCore
import ArgusUI
import SwiftUI

/// ⌘P: open a worktree file by fuzzy name, the session's changed files first.
struct QuickOpenView: View {
  @Environment(\.theme) private var theme
  let code: CodeSession
  @State private var query = ""
  @State private var selected = 0
  @FocusState private var focused: Bool

  var body: some View {
    let results = matches
    VStack(spacing: 0) {
      TextField("Open a file by name…", text: $query)
        .textFieldStyle(.plain)
        .font(.scaled(.title3))
        .padding(12)
        .focused($focused)
        .onSubmit { open(results) }
        .onKeyPress(.downArrow) { move(1, in: results) }
        .onKeyPress(.upArrow) { move(-1, in: results) }
        .onKeyPress(.escape) {
          close()
          return .handled
        }
        .accessibilityLabel("Quick open")
      Divider()
      ScrollViewReader { proxy in
        List {
          if results.isEmpty {
            Text(code.fileListLoading ? "Loading files…" : "No matching files").foregroundStyle(.secondary)
          }
          ForEach(Array(results.enumerated()), id: \.element.path) { index, match in
            QuickOpenRow(match: match, selected: index == selected)
              .id(index)
              .contentShape(Rectangle())
              .onTapGesture { pick(match.path) }
          }
        }
        .listStyle(.plain)
        .onChange(of: selected) { _, index in proxy.scrollTo(index) }
      }
      .frame(height: 340)
    }
    .frame(width: 560)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(theme.border))
    .shadow(radius: 24)
    .onAppear { focused = true }
    .onChange(of: query) { selected = 0 }
    .task { await code.loadFileList() }
  }

  private var matches: [FuzzyFileMatcher.Match] {
    code.matcher.search(query, boost: Set(code.changedEntries.map(\.path)), limit: 50)
  }

  private func move(_ delta: Int, in results: [FuzzyFileMatcher.Match]) -> KeyPress.Result {
    guard !results.isEmpty else { return .handled }
    selected = (selected + delta + results.count) % results.count
    return .handled
  }

  private func open(_ results: [FuzzyFileMatcher.Match]) {
    guard results.indices.contains(selected) else { return }
    pick(results[selected].path)
  }

  private func pick(_ path: String) {
    close()
    code.pin(path)
    code.navigate(to: path, source: .quickOpen)
  }

  private func close() {
    code.quickOpenVisible = false
  }
}

/// A match with its matched characters in bold, the changed files marked.
private struct QuickOpenRow: View {
  @Environment(\.theme) private var theme
  let match: FuzzyFileMatcher.Match
  let selected: Bool

  var body: some View {
    let name = (match.path as NSString).lastPathComponent
    let nameStart = (match.path as NSString).length - (name as NSString).length
    HStack(spacing: 8) {
      Image(systemName: "doc").foregroundStyle(.secondary).frame(width: 18)
      Text(highlighted(match.path, from: nameStart, to: nil))
      Text(highlighted(match.path, from: 0, to: max(0, nameStart - 1)))
        .font(.scaled(.caption))
        .foregroundStyle(theme.textSecondary)
        .lineLimit(1)
        .truncationMode(.head)
      Spacer()
      if match.isBoosted {
        Text("Changed").font(.scaled(.caption)).foregroundStyle(theme.warning)
      }
    }
    .padding(.vertical, 3)
    .listRowBackground(selected ? theme.accentSoft : Color.clear)
  }

  /// `path`'s UTF-16 range `from..<to`, the matched characters emphasised.
  private func highlighted(_ path: String, from start: Int, to end: Int?) -> AttributedString {
    let text = path as NSString
    let end = end ?? text.length
    let hits = Set(match.indices)
    var result = AttributedString()
    var index = start
    while index < end {
      let range = text.rangeOfComposedCharacterSequence(at: index)
      var piece = AttributedString(text.substring(with: range))
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
