import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// One pull request: what it is, its conversation, commits, checks and files,
/// and commenting, merging and closing it — Electron's `PullRequestDetailScreen`.
struct PullRequestDetailScreen: View {
  @Environment(DesktopModel.self) private var desktop
  @Environment(HostStore.self) private var store
  let repo: String
  let number: Int
  /// In a side panel tab: the actions sit in the view, not the window's toolbar or title.
  var embedded = false
  /// The gallery opens a tab other than the conversation.
  var initialTab: PullRequestDetailTab = .conversation
  /// On `/pull-requests/…/guide`: the Guide tab is the route's, so back and deep links reach it.
  var showsGuide = false
  @State private var model: PullRequestDetailModel?

  var body: some View {
    Group {
      if let model {
        PullRequestDetailContent(model: model, embedded: embedded, showsGuide: showsGuide, tab: initialTab)
      } else {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .modifier(PullRequestLoadingTitle(number: number, embedded: embedded))
    .task(id: "\(repo)#\(number)") {
      let model = PullRequestDetailModel(repo: repo, number: number, store: store, pullRequests: desktop.pullRequests)
      self.model = model
      await model.load()
    }
  }
}

private struct PullRequestDetailContent: View {
  @Environment(DesktopModel.self) private var desktop
  @Environment(HostStore.self) private var store
  let model: PullRequestDetailModel
  let embedded: Bool
  let showsGuide: Bool
  @State var tab: PullRequestDetailTab
  @State private var merging = false
  @State private var confirmingClose = false

  /// The route decides the Guide tab; the rest are this view's own.
  private var shown: PullRequestDetailTab { showsGuide ? .guide : tab == .guide && !embedded ? .conversation : tab }

  var body: some View {
    Group {
      if let detail = model.detail {
        VStack(spacing: 0) {
          if let error = model.actionError ?? model.viewed.error {
            GitErrorBanner(message: error) {
              model.actionError = nil
              model.viewed.error = nil
            }
          }
          PullRequestHeader(detail: detail)
          if embedded {
            HStack(spacing: 8) { actions(detail) }
              .controlSize(.small)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal, 16)
              .padding(.top, 8)
          }
          tabs(detail)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
          tabContent(detail)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .gitPanel()
            .gitPanelPadding()
        }
        .modifier(PullRequestWindowChrome(detail: detail, embedded: embedded) { actions(detail) })
      } else if let error = model.loadError {
        VStack(spacing: 0) {
          GitEmptyState(
            systemImage: "exclamationmark.triangle", title: "Couldn't load pull request",
            subtitle: PullRequestLabels.explain(error), actionTitle: "Try Again"
          ) { Task { await model.load() } }
          .fixedSize(horizontal: false, vertical: true)
          Button("Back to Pull Requests") { desktop.navigate(.pullRequests) }
            .buttonStyle(.argusBorderless)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ProgressView("Loading pull request").controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .sheet(isPresented: $merging) {
      if let detail = model.detail {
        MergePullRequestSheet(detail: detail) { strategy in Task { await model.merge(strategy) } }
      }
    }
    .confirmationDialog("Close pull request #\(model.number)?", isPresented: $confirmingClose) {
      Button("Close Pull Request", role: .destructive) { Task { await model.close() } }
    } message: {
      Text("It can be reopened on \(PullRequestLabels.host(model.detail?.url)). The branch is kept.")
    }
    .liveRefresh(enabled: store.connection == .ready, every: .seconds(60)) { await model.load() }
  }

  private func tabs(_ detail: ArgusProtocol.PullRequestDetail) -> some View {
    let passed = detail.checks.filter { PullRequestCheckTone($0) == .success }.count
    let failing = detail.checks.contains { PullRequestCheckTone($0) == .danger }
    let tabs = [
      GitPillTab(id: PullRequestDetailTab.conversation, title: "Conversation", symbol: "bubble.left.and.bubble.right",
                 badge: detail.comments.count),
      GitPillTab(id: .guide, title: "Guide", symbol: Icon.guide),
      GitPillTab(id: .commits, title: "Commits", symbol: "smallcircle.filled.circle", badge: Int(detail.commits)),
      GitPillTab(id: .checks, title: detail.checks.isEmpty ? "Checks" : "Checks \(passed)/\(detail.checks.count)",
                 symbol: "checkmark.seal", indicator: failing),
      GitPillTab(id: .files, title: "Files", symbol: "doc.on.doc", badge: Int(detail.changedFiles)),
    ]
    return GitPillTabBar(tabs: tabs, selection: shown, compact: true) { select($0) }
      .fixedSize()
      .padding(.vertical, 8)
  }

  @ViewBuilder
  private func tabContent(_ detail: ArgusProtocol.PullRequestDetail) -> some View {
    switch shown {
    case .conversation:
      PullRequestConversation(detail: detail, model: model)
    case .guide:
      ReviewGuideScreen(
        target: .pullRequest(repo: model.repo, number: model.number, headSha: detail.commitList.last?.oid))
    case .commits:
      PullRequestCommits(commits: detail.commitList) { model.openOnGitHub($0) }
    case .checks:
      PullRequestChecks(checks: detail.checks) { model.openOnGitHub($0) }
    case .files:
      FileDiffsView(
        files: model.files, isLoading: !model.diffLoaded,
        fileMenu: { _ in
          AnyView(
            Button("View on \(PullRequestLabels.host(detail.url))") {
              model.openOnGitHub(PullRequestLabels.isGitLab(detail.url) ? "\(detail.url)/diffs" : "\(detail.url)/files")
            })
        },
        viewed: model.viewed)
      .overlay {
        if model.diffLoaded, let error = model.diffError {
          GitEmptyState(systemImage: "exclamationmark.triangle", title: "Couldn't load diff", subtitle: error)
            .background(.background)
        } else if model.diffLoaded, model.files.isEmpty {
          GitEmptyState(systemImage: "doc.text", title: "No textual diff").background(.background)
        }
      }
      .task { await model.loadDiffIfNeeded() }
    }
  }

  /// A side panel has no route of its own to put the guide on, so there it's a plain tab.
  private func select(_ item: PullRequestDetailTab) {
    tab = item
    guard !embedded, (item == .guide) != showsGuide else { return }
    desktop.navigate(
      item == .guide
        ? .pullRequestGuide(repo: model.repo, number: model.number)
        : .pullRequest(repo: model.repo, number: model.number))
  }

  @ViewBuilder
  private func actions(_ detail: ArgusProtocol.PullRequestDetail) -> some View {
    Group {
      if let busy = model.busy {
        ProgressView().controlSize(.small).help(busy)
      }
      Button { model.openOnGitHub() } label: { Label(PullRequestLabels.openOn(detail.url), systemImage: "safari") }
        .help(PullRequestLabels.openOn(detail.url))
      if detail.state == "OPEN" {
        Button("Close") { confirmingClose = true }.disabled(model.busy != nil)
        Button("Merge") { merging = true }
          .disabled(model.busy != nil || detail.isDraft || detail.mergeable == "CONFLICTING")
          .help(detail.isDraft ? "Drafts can't be merged" : detail.mergeable == "CONFLICTING" ? "This branch conflicts with its base" : "Merge on \(PullRequestLabels.host(detail.url))")
      }
    }
  }
}

enum PullRequestDetailTab: Hashable { case conversation, guide, commits, checks, files }

/// "#123" in the window's title until the pull request loads, unless it's in a panel.
private struct PullRequestLoadingTitle: ViewModifier {
  let number: Int
  let embedded: Bool

  func body(content: Content) -> some View {
    if embedded { content } else { content.navigationTitle("#\(number)") }
  }
}

/// The window's title and toolbar, for a pull request shown as a screen of its own.
private struct PullRequestWindowChrome<Actions: View>: ViewModifier {
  let detail: ArgusProtocol.PullRequestDetail
  let embedded: Bool
  @ViewBuilder let actions: () -> Actions

  func body(content: Content) -> some View {
    if embedded {
      content
    } else {
      content
        .navigationTitle(detail.title)
        .navigationSubtitle("\(detail.repoNameWithOwner) \(PullRequestLabels.ref(number: Int(detail.number), url: detail.url))")
        .toolbar { ToolbarItemGroup { actions() } }
    }
  }
}

/// Title, state, who, where, and the size of it.
private struct PullRequestHeader: View {
  @Environment(\.theme) private var theme
  let detail: ArgusProtocol.PullRequestDetail

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        GitToneBadge(label: state.label, tone: state.tone, symbol: state.symbol)
        Text(detail.title).font(.scaled(.title3).weight(.semibold)).textSelection(.enabled)
      }
      HStack(spacing: 8) {
        Text(detail.author.map { "\($0) wants to merge" } ?? "Wants to merge").foregroundStyle(.secondary)
        branch(detail.headRefName)
        Image(systemName: "arrow.right").foregroundStyle(.secondary).font(.scaled(.caption))
        branch(detail.baseRefName)
        Text("· opened \(PullRequestLabels.relative(detail.createdAt))").foregroundStyle(.secondary)
      }
      .font(.scaled(size: 12))
      HStack(spacing: 10) {
        DiffStatsLabel(stats: DiffStats(additions: Int(detail.additions), deletions: Int(detail.deletions)))
        Text("\(Int(detail.changedFiles)) files · \(Int(detail.commits)) commits").font(.scaled(size: 11))
          .foregroundStyle(.secondary)
        ForEach(detail.labels, id: \.self) { GitToneBadge(label: $0, tone: .muted, symbol: "tag") }
        if detail.mergeable == "CONFLICTING", !detail.merged {
          Label("Conflicts with \(detail.baseRefName)", systemImage: "exclamationmark.triangle")
            .font(.scaled(size: 11)).foregroundStyle(theme.warning)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 16)
    .padding(.top, 12)
  }

  private func branch(_ name: String) -> some View {
    GitBranchLabel(name: name, kind: .remoteBranch, maxNameWidth: 260).help(name)
  }

  private var state: (label: String, tone: Tone, symbol: String) {
    if detail.merged { return ("Merged", .accent, "arrow.triangle.merge") }
    if detail.state == "CLOSED" { return ("Closed", .danger, "xmark.circle.fill") }
    return detail.isDraft ? ("Draft", .muted, "pencil") : ("Open", .success, "arrow.triangle.pull")
  }
}

/// Strategy and confirmation, in one step.
private struct MergePullRequestSheet: View {
  @Environment(\.dismiss) private var dismiss
  let detail: ArgusProtocol.PullRequestDetail
  let merge: (RemoteMergeStrategy) -> Void
  @AppStorage(RemoteMergeStrategy.preferenceKey) private var strategy: RemoteMergeStrategy = .squash

  var body: some View {
    Form {
      Picker("Strategy", selection: $strategy) {
        ForEach(RemoteMergeStrategy.allCases, id: \.self) { Text($0.label).tag($0) }
      }
      .pickerStyle(.radioGroup)
      if !detail.checks.isEmpty, detail.checks.contains(where: { PullRequestCheckTone($0) != .success }) {
        Label("Not every check has passed.", systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .safeAreaInset(edge: .top) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Merge \(PullRequestLabels.ref(number: Int(detail.number), url: detail.url))?").font(.scaled(.headline))
        Text("\(detail.headRefName) into \(detail.baseRefName) on \(PullRequestLabels.host(detail.url)). This can't be undone from here.")
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding([.top, .horizontal], 20)
    }
    .frame(width: 440)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      ToolbarItem(placement: .confirmationAction) {
        Button("Merge") {
          merge(strategy)
          dismiss()
        }
      }
    }
  }
}
