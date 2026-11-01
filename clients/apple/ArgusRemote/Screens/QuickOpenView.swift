import ArgusUI
import SwiftUI

/// Find a session file by name: fuzzy matching over the worktree's files, the
/// ones this session changed first.
struct QuickOpenView: View {
  @Environment(HostStore.self) private var host

  let sessionId: String
  let label: String

  @State private var matcher: FuzzyFileMatcher?
  @State private var changed: Set<String> = []
  @State private var query = ""

  private var results: [FuzzyFileMatcher.Match] {
    matcher?.search(query, boost: changed, limit: 100) ?? []
  }

  var body: some View {
    List {
      if !host.hasControl {
        ControlRequiredBanner(action: "browse files")
          .listRowBackground(Color.clear)
          .listRowSeparator(.hidden)
      } else if matcher == nil {
        Loading(label: "Listing files…").listRowSeparator(.hidden)
      } else {
        ForEach(results, id: \.path) { match in
          StackLink(
            route: .file(sessionId: sessionId, path: match.path, line: nil, source: .quickOpen)
          ) {
            FuzzyFileRow(match: match)
          }
        }
      }
    }
    // Plain: a grouped list opens with a section's worth of gap under the search field.
    .listStyle(.plain)
    .emptyState(when: host.hasControl && matcher != nil && results.isEmpty, grouped: false) {
      EmptyState(
        icon: Icon.search, title: "No matching files",
        body: query.isEmpty ? "This session has no files." : "Nothing in this worktree matches “\(query)”.")
    }
    .screenSearch(text: $query, prompt: "File name")
    .autocorrectionDisabled()
    .textInputAutocapitalization(.never)
    .navigationTitle("Open File · \(label)")
    .navigationBarTitleDisplayMode(.inline)
    .refreshable { await load() }
    .task(id: host.connection == .ready) {
      guard matcher == nil, host.connection == .ready else { return }
      await load()
    }
  }

  private func load() async {
    guard host.hasControl else { return }
    async let files = host.listFiles(sessionId: sessionId)
    async let diff = host.loadDiff(sessionId: sessionId, mode: "branch")
    let (paths, patch) = await (files, diff)
    changed = Set(DiffParser.parse(patch).filter { $0.status != .deleted }.map(\.displayPath))
    matcher = FuzzyFileMatcher(paths: paths)
  }
}
