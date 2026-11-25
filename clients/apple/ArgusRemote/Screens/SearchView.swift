import ArgusCore
import ArgusUI
import SwiftUI

/// `/search`: agents, sessions and teammates on the computer by name, matched
/// as the Mac's command palette matches. A result opens its own screen.
struct SearchView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(TeammatesStore.self) private var teammates
  @Environment(Router.self) private var router

  @State private var query: String
  /// Counted once per visit: a tapped result, or a search left without one.
  @State private var counted = false

  init(query: String = "") {
    _query = State(initialValue: query)
  }

  private var results: [HostSearchResult] {
    HostSearch.results(query, in: HostSearch.items(host: host, teammates: teammates.summaries.map(\.teammate)))
  }

  var body: some View {
    let results = results
    List {
      ForEach(HostSearch.grouped(results), id: \.kind) { group in
        Section(group.kind.title) {
          ForEach(group.items) { result in
            Button { open(result, count: results.count) } label: { row(result) }
              .buttonStyle(.argusPlain)
          }
        }
      }
    }
    .listStyle(.insetGrouped)
    .overlay {
      if query.trimmingCharacters(in: .whitespaces).isEmpty {
        EmptyState(icon: Icon.search, title: "Search", body: "Find an agent, a session or a teammate by name.")
      } else if results.isEmpty {
        EmptyState(icon: Icon.search, title: "No matches", body: "Nothing on this computer is called that.")
      }
    }
    .screenSearch(text: $query, prompt: "Agents, sessions, teammates")
    .navigationTitle("Search")
    .navigationBarTitleDisplayMode(.inline)
    .task(id: host.connection == .ready) {
      guard host.connection == .ready else { return }
      await host.loadRecentAgents()
      await teammates.refresh()
      for project in host.projects where host.sessionsByRepo[project.repoRoot] == nil {
        await host.loadSessions(repoRoot: project.repoRoot)
      }
    }
    .onDisappear {
      guard !counted, !query.trimmingCharacters(in: .whitespaces).isEmpty else { return }
      Telemetry.capture(.searchUsed(kind: nil, results: results.count))
    }
  }

  private func row(_ result: HostSearchResult) -> some View {
    HStack(spacing: 12) {
      Image(systemName: symbol(result.kind))
        .font(.scaled(size: 15))
        .foregroundStyle(theme.textSecondary)
        .frame(width: TextScale.shared(24))
      VStack(alignment: .leading, spacing: 2) {
        BodyText(result.title, lineLimit: 1)
        if let subtitle = result.subtitle { MutedText(subtitle, lineLimit: 1) }
      }
      Spacer(minLength: 6)
      Image(systemName: Icon.chevronRight)
        .font(.scaled(.footnote).weight(.semibold))
        .foregroundStyle(theme.textMuted)
    }
    .contentShape(.rect)
  }

  private func symbol(_ kind: HostSearchResult.Kind) -> String {
    switch kind {
    case .agent: Icon.agent
    case .session: Icon.branch
    case .teammate: Icon.teammates
    }
  }

  private func open(_ result: HostSearchResult, count: Int) {
    counted = true
    Telemetry.capture(.searchUsed(kind: result.kind, results: count))
    switch result.kind {
    case .agent:
      router.push(.agent(id: result.itemId, label: result.title))
    case .session:
      router.push(.session(id: result.itemId, label: result.title, repoRoot: result.repoRoot ?? ""))
    case .teammate:
      router.push(.teammate(id: result.itemId, page: .chat(threadId: nil)))
    }
  }
}
