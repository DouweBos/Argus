import ArgusCore
import SwiftUI

/// Search a project's saved chats by title and message text, as the Mac's
/// Recent Chats does; picking one hands it back to open.
public struct ChatSearchSheet: View {
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss

  let repoRoot: String
  let open: (RemoteStoppedAgent) -> Void
  /// The first keystroke of a search.
  let searched: () -> Void

  @State private var query = ""
  @State private var hits: (query: String, matches: [String: [ChatHistoryMatch]])?
  @State private var counted = false

  public init(repoRoot: String, open: @escaping (RemoteStoppedAgent) -> Void, searched: @escaping () -> Void) {
    self.repoRoot = repoRoot
    self.open = open
    self.searched = searched
  }

  private var needle: String { query.trimmingCharacters(in: .whitespaces) }

  private var shown: [RemoteStoppedAgent] {
    HostStore.filterChats(host.stoppedByRepo[repoRoot] ?? [], query: needle, hits: hits)
  }

  public var body: some View {
    NavigationStack {
      List {
        ForEach(shown) { chat in
          Button {
            dismiss()
            open(chat)
          } label: {
            VStack(alignment: .leading, spacing: 2) {
              StoppedAgentRow(agent: chat)
              if !needle.isEmpty {
                ForEach(Array((hits?.matches[chat.historyId] ?? []).enumerated()), id: \.offset) { _, match in
                  MatchSnippet(match: match)
                }
              }
            }
          }
          .buttonStyle(.argusPlain)
        }
      }
      .overlay {
        if shown.isEmpty {
          EmptyState(
            icon: Icon.history, title: needle.isEmpty ? "No saved chats" : "No matches",
            body: needle.isEmpty
              ? "Chats this project's agents have finished show up here."
              : "No chat mentions \u{201C}\(needle)\u{201D}.")
        }
      }
      .searchable(text: $query, prompt: "Search chats & messages")
      .navigationTitle("Saved chats")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Done") { dismiss() }
        }
      }
      .task { await host.loadStoppedAgents(repoRoot: repoRoot) }
      .task(id: needle) { await search(needle) }
      .onChange(of: query) { _, value in
        guard !counted, !value.isEmpty else { return }
        counted = true
        searched()
      }
    }
  }

  private func search(_ needle: String) async {
    guard !needle.isEmpty else { return }
    try? await Task.sleep(for: .milliseconds(200))
    guard !Task.isCancelled,
      let matches = await host.searchChatHistory(repoRoot: repoRoot, query: needle),
      !Task.isCancelled
    else { return }
    hits = (needle, matches)
  }
}
