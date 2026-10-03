import ArgusUI
import GroveKit
import SwiftUI

/// `/pull-requests`: the PRs you're authoring, reviewing or mentioned on
/// across every open project, grouped by what they need from you.
struct PullRequestsScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @State private var search = ""
  @State private var repo: String?
  @State private var refreshing = false

  private var prs: PullRequestsStore { model.pullRequests }

  var body: some View {
    PullRequestList(
      pullRequests: filtered, loaded: prs.loaded, error: prs.error, showsRepo: repo == nil,
      emptyTitle: search.isEmpty ? "No pull requests of interest" : "No matches",
      emptyText: store.projects.isEmpty
        ? "Open a project to see PRs from that repo here."
        : "When you're authoring, reviewing, or mentioned on a PR in one of your open projects, it'll appear here.",
      retry: refresh)
    .navigationTitle("Pull Requests")
    .navigationSubtitle(subtitle)
    .searchable(text: $search, placement: .toolbar, prompt: "Filter pull requests")
    .toolbar {
      ToolbarItemGroup {
        if repos.count > 1 {
          Picker("Repository", selection: $repo) {
            Text("All Repositories").tag(String?.none)
            Divider()
            ForEach(repos, id: \.self) { Text($0).tag(String?.some($0)) }
          }
          .fixedSize()
        }
        Button(action: refresh) { Label("Refresh", systemImage: "arrow.clockwise") }
          .disabled(refreshing)
          .help("Ask GitHub again")
      }
    }
    .task { await load() }
    .liveRefresh(enabled: store.connection == .ready, every: .seconds(60)) { await prs.refresh() }
  }

  private var repos: [String] { Array(Set(prs.pullRequests.map(\.repo))).sorted() }

  private var filtered: [RemotePullRequest] {
    let query = search.trimmingCharacters(in: .whitespaces).lowercased()
    return prs.pullRequests.filter { pr in
      (repo == nil || pr.repo == repo)
        && (query.isEmpty || pr.title.lowercased().contains(query) || pr.headRef.lowercased().contains(query)
          || "#\(pr.number)".contains(query) || (pr.author?.lowercased().contains(query) ?? false))
    }
  }

  private var subtitle: String {
    guard prs.loaded else { return "Loading…" }
    let base = "\(prs.pullRequests.count) open · authored, reviewing, or commented"
    return refreshing ? "\(base) · refreshing…" : base
  }

  private func refresh() { Task { await load() } }

  private func load() async {
    refreshing = true
    await prs.refresh()
    refreshing = false
  }
}

/// A grouped PR list with its loading, error and empty states; the global
/// screen and the git panel's project list both show this.
struct PullRequestList: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let pullRequests: [RemotePullRequest]
  let loaded: Bool
  let error: String?
  var showsRepo = true
  var emptyTitle = "No pull requests"
  var emptyText = ""
  let retry: () -> Void
  @State private var starting: String?
  @State private var selection: String?

  var body: some View {
    states.frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  @ViewBuilder
  private var states: some View {
    if !loaded {
      ProgressView("Asking GitHub…").controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if let error, pullRequests.isEmpty {
      ContentUnavailableView {
        Label("Couldn't fetch pull requests", systemImage: "exclamationmark.triangle")
      } description: {
        Text(PullRequestLabels.explain(error)).textSelection(.enabled)
      } actions: {
        Button("Try Again", action: retry)
      }
    } else if pullRequests.isEmpty {
      ContentUnavailableView(emptyTitle, systemImage: "arrow.triangle.pull", description: Text(emptyText))
    } else {
      list
    }
  }

  private var list: some View {
    let groups = PullRequestBucket.group(pullRequests)
    let actions = PullRequestActions(model: model, store: store)
    return List(selection: $selection) {
      if let error {
        Label(PullRequestLabels.explain(error), systemImage: "exclamationmark.triangle")
          .foregroundStyle(.secondary)
      }
      if !groups.contains(where: { $0.bucket.needsAttention }) {
        Label("Nothing waiting on you right now.", systemImage: "checkmark.circle")
          .foregroundStyle(.secondary)
      }
      ForEach(groups, id: \.bucket) { group in
        Section {
          ForEach(group.prs) { pr in
            PullRequestRow(
              pullRequest: pr, sessionId: actions.session(for: pr), starting: starting == pr.id,
              showsRepo: showsRepo
            ) { action in
              actions.perform(action, pr, starting: $starting)
            }
            .tag(pr.id)
          }
        } header: {
          Text("\(group.bucket.title) · \(group.prs.count)")
        }
      }
    }
    .listStyle(.inset)
    .contextMenu(forSelectionType: String.self) { ids in
      if let pr = pullRequests.first(where: { ids.contains($0.id) }) {
        PullRequestMenu(sessionId: actions.session(for: pr)) { actions.perform($0, pr, starting: $starting) }
      }
    } primaryAction: { ids in
      guard let pr = pullRequests.first(where: { ids.contains($0.id) }) else { return }
      model.navigate(.pullRequest(repo: pr.repo, number: pr.number))
    }
  }
}
