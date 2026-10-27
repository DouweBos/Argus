import ArgusCore
import ArgusUI
import SwiftUI

/// The navigator's Search mode (⇧⌘F): results stream in grouped by file;
/// a click opens the file at the line.
struct CodeSearchView: View {
  @Environment(\.theme) private var theme
  @Bindable var search: CodeSearchModel
  let code: CodeSession
  @FocusState private var focused: Bool
  @State private var debounce: Task<Void, Never>?

  var body: some View {
    VStack(spacing: 0) {
      form
      Rectangle().fill(theme.border).frame(height: 1)
      results
    }
    .onChange(of: search.focusRequest, initial: true) { focused = true }
    .onChange(of: SearchOptions(search)) { _, _ in
      debounce?.cancel()
      debounce = Task {
        try? await Task.sleep(for: .milliseconds(300))
        if !Task.isCancelled { search.run() }
      }
    }
  }

  private var form: some View {
    VStack(spacing: 6) {
      HStack(spacing: 4) {
        TextField("Search the worktree", text: $search.query)
          .quietField()
          .focused($focused)
          .onSubmit(search.run)
          .accessibilityLabel("Search query")
        toggle("Aa", isOn: $search.isCaseSensitive, help: "Match case")
        toggle("ab", isOn: $search.isWholeWord, help: "Whole word", underline: true)
        toggle(".*", isOn: $search.isRegex, help: "Regular expression")
      }
      DisclosureGroup("Files to include or exclude", isExpanded: $search.showsFilters) {
        VStack(spacing: 4) {
          TextField("Include, e.g. src/**, *.swift", text: $search.include)
          TextField("Exclude, e.g. **/Generated/**", text: $search.exclude)
        }
        .quietField()
        .onSubmit(search.run)
      }
      .font(.scaled(size: 11))
      summary
    }
    .controlSize(.small)
    .padding(8)
  }

  @ViewBuilder private var summary: some View {
    HStack(spacing: 6) {
      if search.isRunning { ProgressView().controlSize(.mini) }
      if let error = search.error {
        Text(error).foregroundStyle(theme.error).lineLimit(2)
      } else if !search.query.isEmpty, !search.isRunning || search.matchCount > 0 {
        Text(countLabel).foregroundStyle(theme.textSecondary)
      }
      Spacer()
      if search.isRunning { Button("Stop", action: search.cancel).buttonStyle(.accentLink) }
    }
    .font(.scaled(size: 11))
  }

  private var countLabel: String {
    let files = search.results.count
    let base = "\(search.matchCount) result\(search.matchCount == 1 ? "" : "s") in \(files) file\(files == 1 ? "" : "s")"
    return search.truncated ? base + " (first \(CodeSearchModel.maxResults) shown)" : base
  }

  private var results: some View {
    List {
      ForEach(search.results) { file in
        Section {
          ForEach(Array(file.matches.enumerated()), id: \.offset) { _, match in
            CodeSearchMatchRow(match: match)
              .contentShape(Rectangle())
              .onTapGesture { code.navigate(to: match.relativePath, line: match.line, source: .search) }
              .clickable()
          }
        } header: {
          HStack(spacing: 4) {
            FileTypeIcon(path: file.path, size: 14)
            Text((file.path as NSString).lastPathComponent).font(.scaled(size: 12, weight: .semibold))
            Text((file.path as NSString).deletingLastPathComponent)
              .font(.scaled(size: 11)).foregroundStyle(theme.textSecondary).lineLimit(1).truncationMode(.head)
            Spacer()
            Text("\(file.matches.count)").font(.scaled(size: 11)).foregroundStyle(theme.textSecondary)
          }
        }
      }
    }
    .navigatorList()
  }

  private func toggle(_ label: String, isOn: Binding<Bool>, help: String, underline: Bool = false) -> some View {
    Button {
      isOn.wrappedValue.toggle()
    } label: {
      Text(label).font(.scaled(size: 11, weight: .semibold, design: .monospaced)).underline(underline)
    }
    .buttonStyle(FlatIconButtonStyle(selected: isOn.wrappedValue, size: 24))
    .help(help)
    .accessibilityLabel(help)
    .accessibilityAddTraits(isOn.wrappedValue ? .isSelected : [])
  }
}

/// What a change re-runs the search on.
private struct SearchOptions: Equatable {
  let query: String
  let regex: Bool
  let caseSensitive: Bool
  let wholeWord: Bool

  @MainActor init(_ search: CodeSearchModel) {
    query = search.query
    regex = search.isRegex
    caseSensitive = search.isCaseSensitive
    wholeWord = search.isWholeWord
  }
}

/// One hit: the line number and the line, the match marked.
private struct CodeSearchMatchRow: View {
  @Environment(\.theme) private var theme
  let match: ArgusProtocol.CodeSearchMatch

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Text("\(match.line)")
        .font(.scaled(size: 10, design: .monospaced))
        .foregroundStyle(theme.textMuted)
        .frame(minWidth: 28, alignment: .trailing)
      Text(highlighted).font(.scaled(size: 11, design: .monospaced)).lineLimit(1)
    }
  }

  private var highlighted: AttributedString {
    let preview = match.preview as NSString
    // `column` counts from the line's start, the preview from `previewOffset`.
    let start = min(max(0, match.column - match.previewOffset), preview.length)
    let length = min(max(0, match.length), preview.length - start)
    var text = AttributedString(preview.substring(to: start))
    var hit = AttributedString(preview.substring(with: NSRange(location: start, length: length)))
    hit.backgroundColor = theme.accentSoft
    hit.foregroundColor = theme.text
    text += hit
    text += AttributedString(preview.substring(from: start + length))
    return text
  }
}
