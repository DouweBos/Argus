import ArgusUI
import GroveKit
import SwiftUI

/// One pull request: what it is, its conversation, commits, checks and files,
/// and commenting, merging and closing it — Electron's `PullRequestDetailScreen`.
struct PullRequestDetailScreen: View {
  @Environment(DesktopModel.self) private var desktop
  @Environment(HostStore.self) private var store
  let repo: String
  let number: Int
  @State private var model: PullRequestDetailModel?

  var body: some View {
    Group {
      if let model {
        PullRequestDetailContent(model: model)
      } else {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .navigationTitle("#\(number)")
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
  @State private var tab: Tab = .conversation
  @State private var merging = false
  @State private var confirmingClose = false

  enum Tab: Hashable { case conversation, commits, checks, files }

  var body: some View {
    Group {
      if let detail = model.detail {
        VStack(spacing: 0) {
          if let error = model.actionError {
            GitErrorBanner(message: error) { model.actionError = nil }
          }
          PullRequestHeader(detail: detail)
          tabs(detail)
          Divider()
          tabContent(detail)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle(detail.title)
        .navigationSubtitle("\(detail.repoNameWithOwner) #\(Int(detail.number))")
        .toolbar { toolbar(detail) }
      } else if let error = model.loadError {
        ContentUnavailableView {
          Label("Couldn't load pull request", systemImage: "exclamationmark.triangle")
        } description: {
          Text(PullRequestLabels.explain(error)).textSelection(.enabled)
        } actions: {
          Button("Try Again") { Task { await model.load() } }
          Button("Back to Pull Requests") { desktop.navigate(.pullRequests) }
        }
      } else {
        ProgressView("Loading pull request…").controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
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
      Text("It can be reopened on GitHub. The branch is kept.")
    }
    .liveRefresh(enabled: store.connection == .ready, every: .seconds(60)) { await model.load() }
  }

  private func tabs(_ detail: ArgusProtocol.PullRequestDetail) -> some View {
    let passed = detail.checks.filter { PullRequestCheckTone($0) == .success }.count
    return Picker("Section", selection: $tab) {
      Text("Conversation (\(detail.comments.count))").tag(Tab.conversation)
      Text("Commits (\(Int(detail.commits)))").tag(Tab.commits)
      Text(detail.checks.isEmpty ? "Checks" : "Checks (\(passed)/\(detail.checks.count))").tag(Tab.checks)
      Text("Files (\(Int(detail.changedFiles)))").tag(Tab.files)
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .fixedSize()
    .padding(.vertical, 8)
  }

  @ViewBuilder
  private func tabContent(_ detail: ArgusProtocol.PullRequestDetail) -> some View {
    switch tab {
    case .conversation:
      PullRequestConversation(detail: detail, model: model)
    case .commits:
      PullRequestCommits(commits: detail.commitList) { model.openOnGitHub($0) }
    case .checks:
      PullRequestChecks(checks: detail.checks) { model.openOnGitHub($0) }
    case .files:
      FileDiffsView(files: model.files, isLoading: !model.diffLoaded) { file in
        AnyView(Button("View on GitHub") { model.openOnGitHub("\(detail.url)/files") })
      }
      .overlay {
        if model.diffLoaded, let error = model.diffError {
          ContentUnavailableView("Couldn't load diff", systemImage: "exclamationmark.triangle", description: Text(error))
            .background(.background)
        } else if model.diffLoaded, model.files.isEmpty {
          ContentUnavailableView("No textual diff", systemImage: "doc.text").background(.background)
        }
      }
      .task { await model.loadDiffIfNeeded() }
    }
  }

  @ToolbarContentBuilder
  private func toolbar(_ detail: ArgusProtocol.PullRequestDetail) -> some ToolbarContent {
    ToolbarItemGroup {
      if let busy = model.busy {
        ProgressView().controlSize(.small).help(busy)
      }
      Button { model.openOnGitHub() } label: { Label("Open on GitHub", systemImage: "safari") }
        .help("Open on GitHub")
      if detail.state == "OPEN" {
        Button("Close…") { confirmingClose = true }.disabled(model.busy != nil)
        Button("Merge…") { merging = true }
          .disabled(model.busy != nil || detail.isDraft || detail.mergeable == "CONFLICTING")
          .help(detail.isDraft ? "Drafts can't be merged" : detail.mergeable == "CONFLICTING" ? "This branch conflicts with its base" : "Merge on GitHub")
      }
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
        Badge(label: state.label, tone: state.tone)
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
        ForEach(detail.labels, id: \.self) { Badge(label: $0, tone: .muted) }
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
    Text(name)
      .font(.scaled(size: 11, design: .monospaced))
      .padding(.horizontal, 6)
      .padding(.vertical, 2)
      .background(theme.bgTertiary, in: .rect(cornerRadius: 4))
      .textSelection(.enabled)
  }

  private var state: (label: String, tone: Tone) {
    if detail.merged { return ("Merged", .accent) }
    if detail.state == "CLOSED" { return ("Closed", .danger) }
    return detail.isDraft ? ("Draft", .muted) : ("Open", .success)
  }
}

/// Strategy and confirmation, in one step.
private struct MergePullRequestSheet: View {
  @Environment(\.dismiss) private var dismiss
  let detail: ArgusProtocol.PullRequestDetail
  let merge: (RemoteMergeStrategy) -> Void
  @AppStorage("pullRequestMergeStrategy") private var strategy: RemoteMergeStrategy = .squash

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
        Text("Merge #\(Int(detail.number))?").font(.scaled(.headline))
        Text("\(detail.headRefName) into \(detail.baseRefName) on GitHub. This can't be undone from here.")
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
