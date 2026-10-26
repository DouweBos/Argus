import ArgusUI
import GroveKit
import SwiftUI

/// The commit graph over the selected commit's detail. Serves `/history`,
/// the ref routes (`branches/:name`, `tags/:name`) and the session branch's
/// own view, which dims commits its base already has.
struct HistoryScreen: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let history: HistoryViewModel
  let ref: String?
  let baseBranch: String?
  @State private var ownCommits: Set<String>?
  @State private var checkoutTarget: CommitInfo?

  private var actions: HistoryActions {
    var actions = HistoryActions(workspace: workspace, history: history) { [model, workspace] route in
      model.navigate(.sessionGit(id: workspace.sessionId, view: route))
    }
    actions.confirmCheckout = { checkoutTarget = $0 }
    return actions
  }

  var body: some View {
    let actions = actions
    // Grove's list and detail cards; stacked, since the graph's columns want the width.
    ResizableVSplit(
      key: "git.history.detail", topMin: 160, bottomMin: 300, bottomIdeal: 480, showsBottom: true, gap: 12
    ) {
      VStack(spacing: 0) {
        HistoryToolbar(history: history, title: title)
        if let error = history.errorMessage, history.pendingAction == nil {
          GitErrorBanner(message: error) { history.dismissError() }
        }
        list(actions)
      }
      .panel()
    } bottom: {
      CommitDetailView(actions: actions).panel()
    }
    .sheet(item: sheetBinding) { HistoryActionSheet(actions: actions, action: $0) }
    .confirmationDialog(
      "Check out \(checkoutTarget?.shortSHA ?? "")?",
      isPresented: Binding(get: { checkoutTarget != nil }, set: { if !$0 { checkoutTarget = nil } }),
      presenting: checkoutTarget
    ) { commit in
      Button("Check Out") { Task { await actions.checkout(commit) } }
    } message: { _ in
      Text("HEAD will be detached at this commit. Commits made there belong to no branch until you create one.")
    }
    .task { history.onRebaseStopped = { actions.navigate(.conflicts) } }
    .task(id: OwnKey(base: baseBranch, generation: workspace.generation)) { await loadOwnCommits() }
  }

  @ViewBuilder
  private func list(_ actions: HistoryActions) -> some View {
    if history.filteredCommits.isEmpty && !history.isLoading {
      EmptyState(
        icon: history.isFiltering ? "magnifyingglass" : "clock",
        title: history.isFiltering ? "No matching commits" : "No commits",
        body: history.isFiltering ? "Nothing loaded matches \u{201C}\(history.searchText)\u{201D}." : "Commits show up here."
      )
    } else {
      CommitTableView(history: history, ownCommits: ownCommits) { menu, commit, selected in
        actions.fill(menu, commit: commit, selected: selected)
      }
    }
  }

  private var title: String {
    if let baseBranch { return "\(history.headBranchName ?? "Branch") vs \(baseBranch)" }
    return ref ?? "History"
  }

  /// Sheets only for the actions that need one; the rest navigate.
  private var sheetBinding: Binding<HistoryAction?> {
    Binding(
      get: {
        switch history.pendingAction {
        case .interactiveRebase, .compare, nil: nil
        case let action?: action
        }
      },
      set: { if $0 == nil { history.dismissAction() } })
  }

  private struct OwnKey: Hashable {
    let base: String?
    let generation: Int
  }

  private func loadOwnCommits() async {
    guard let baseBranch else { return ownCommits = nil }
    ownCommits = (try? await workspace.repository.commits(in: "HEAD", notIn: baseBranch)) ?? nil
  }
}

/// Title, commit count, search and the graph/table toggle.
private struct HistoryToolbar: View {
  let history: HistoryViewModel
  let title: String

  var body: some View {
    HStack(spacing: 8) {
      Text(title).font(.scaled(size: 13, weight: .semibold)).lineLimit(1)
      Text(count).font(.scaled(size: 11)).foregroundStyle(.secondary)
      if history.isLoading { ProgressView().controlSize(.mini) }
      Spacer()
      TextField(
        "Filter commits", text: Binding(get: { history.searchText }, set: { history.setSearchText($0) })
      )
      .textFieldStyle(.roundedBorder)
      .controlSize(.small)
      .frame(maxWidth: 220)
      Picker("Layout", selection: Binding(get: { history.layout }, set: { history.setLayout($0) })) {
        ForEach(HistoryLayout.allCases) { layout in
          Image(systemName: layout.symbol).help(layout.title).accessibilityLabel(layout.title).tag(layout)
        }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .fixedSize()
    }
    .padding(.horizontal, 14)
    .frame(height: 40)
    .overlay(alignment: .bottom) { Divider() }
  }

  private var count: String {
    let shown = history.isFiltering ? history.filteredCommits.count : history.commits.count
    return "\(shown)\(history.hasMore ? "+" : "") commits"
  }
}
