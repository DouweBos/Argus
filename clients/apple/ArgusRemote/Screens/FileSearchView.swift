import ArgusUI
import SwiftUI

/// Search a session's worktree: results stream in grouped by file, and a tap
/// opens the file at the matching line.
struct FileSearchView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let sessionId: String
  let label: String

  @State private var store: FileSearchStore?
  @State private var text = ""
  @State private var regex = false
  @State private var caseSensitive = false
  @State private var wholeWord = false

  private var query: FileSearchQuery {
    FileSearchQuery(text: text, regex: regex, caseSensitive: caseSensitive, wholeWord: wholeWord)
  }

  var body: some View {
    List {
      if !host.hasControl {
        ControlRequiredBanner(action: "search files")
          .listRowBackground(Color.clear)
          .listRowSeparator(.hidden)
      } else {
        options
          .listRowSeparator(.hidden)
        if let store { results(store) }
      }
    }
    // Plain: hits read as one compact list under each file, not a card apiece.
    .listStyle(.plain)
    .emptyState(when: host.hasControl && placeholder != nil, grouped: false) {
      if let placeholder { placeholder }
    }
    .searchable(
      text: $text, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search this worktree")
    .autocorrectionDisabled()
    .textInputAutocapitalization(.never)
    .navigationTitle("Search · \(label)")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      guard store == nil else { return }
      let store = FileSearchStore(host: host, sessionId: sessionId)
      store.onFinished = { query, count, truncated in
        Telemetry.capture(.fileSearchRun(regex: query.regex, results: count, truncated: truncated))
      }
      self.store = store
    }
    // Debounced: a new keystroke cancels the wait, and `run` cancels the last search.
    .task(id: query) {
      guard host.hasControl, let store else { return }
      store.schedule(query)
    }
    .onDisappear {
      guard let store else { return }
      Task { await store.cancel() }
    }
  }

  private var options: some View {
    HStack(spacing: 8) {
      Toggle("Regex", isOn: $regex)
      Toggle("Match case", isOn: $caseSensitive)
      Toggle("Whole word", isOn: $wholeWord)
    }
    .toggleStyle(.button)
    .buttonStyle(.bordered)
    .controlSize(.small)
    .font(.scaled(size: 12))
  }

  /// Idle or empty, centred on the screen rather than sat in a row.
  private var placeholder: EmptyState<EmptyView>? {
    switch store?.phase {
    case .idle:
      EmptyState(icon: Icon.search, title: "Search files", body: "Find text across every file in this session.")
    case .done(0, _):
      EmptyState(icon: Icon.search, title: "No results", body: "Nothing in this worktree matches.")
    default: nil
    }
  }

  @ViewBuilder
  private func results(_ store: FileSearchStore) -> some View {
    switch store.phase {
    case .idle, .done(0, _):
      EmptyView()
    case .failed(let message):
      Banner(text: message, tone: .danger)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    case .running where store.groups.isEmpty:
      Loading(label: "Searching…")
        .listRowSeparator(.hidden)
    default:
      MutedText(summary(store), lineLimit: 2)
        .listRowSeparator(.hidden)
      ForEach(store.groups) { group in
        Section {
          ForEach(Array(group.matches.enumerated()), id: \.offset) { _, match in
            NavigationLink(
              value: Route.file(
                sessionId: sessionId, path: match.relativePath, line: match.line, source: .search)
            ) {
              FileSearchMatchRow(match: match)
            }
          }
        } header: {
          FileSearchGroupHeader(path: group.path, count: group.matches.count)
        }
      }
    }
  }

  private func summary(_ store: FileSearchStore) -> String {
    let count = "\(store.matchCount) result\(store.matchCount == 1 ? "" : "s") in \(store.groups.count) file\(store.groups.count == 1 ? "" : "s")"
    switch store.phase {
    case .running: return "\(count) so far…"
    case .done(_, true): return "\(count) — stopped at the limit, refine the search to see the rest"
    default: return count
    }
  }
}
