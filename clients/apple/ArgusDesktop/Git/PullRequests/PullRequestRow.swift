import ArgusUI
import SwiftUI

/// One PR in a list: title, state, who and where, why you're seeing it, and
/// the actions Electron's row offers.
struct PullRequestRow: View {
  @Environment(\.theme) private var theme
  let pullRequest: RemotePullRequest
  /// The worktree session already on this PR's branch, if any.
  var sessionId: String?
  var starting = false
  var showsRepo = true
  let act: (Action) -> Void

  enum Action { case openDetail, openInBrowser, openSession(String), startSession, copyURL }

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: "arrow.triangle.pull")
        .foregroundStyle(pullRequest.isDraft ? theme.textMuted : theme.success)
        .padding(.top, 2)
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 6) {
          Text(pullRequest.title).font(.system(size: 13, weight: .medium)).lineLimit(2)
          if pullRequest.isDraft { Badge(label: "Draft", tone: .muted) }
          if let decision = pullRequest.reviewDecision, let review = PullRequestLabels.review(decision) {
            Badge(label: review.label, tone: review.tone)
          }
        }
        Text(meta).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
        HStack(spacing: 4) {
          ForEach(pullRequest.reasons, id: \.self) { reason in
            Badge(label: PullRequestLabels.reason(reason), tone: PullRequestLabels.reasonTone(reason))
          }
          Label(pullRequest.headRef, systemImage: "arrow.triangle.branch")
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.middle)
        }
      }
      Spacer(minLength: 8)
      HStack(spacing: 6) {
        Button { act(.openInBrowser) } label: { Image(systemName: "safari") }
          .buttonStyle(.borderless)
          .help("Open on GitHub")
        if let sessionId {
          Button("Open Session") { act(.openSession(sessionId)) }
        } else {
          Button(starting ? "Starting…" : "New Session") { act(.startSession) }.disabled(starting)
        }
      }
      .controlSize(.small)
    }
    .padding(.vertical, 4)
  }

  private var meta: String {
    var parts: [String] = []
    if showsRepo { parts.append(pullRequest.repo) }
    parts.append("#\(pullRequest.number)")
    parts.append(pullRequest.author.map { "by \($0)" } ?? "unknown author")
    parts.append("updated \(PullRequestLabels.relative(pullRequest.updatedAt))")
    return parts.joined(separator: " · ")
  }
}

/// A PR's context menu; the list shows it for the selection.
struct PullRequestMenu: View {
  let sessionId: String?
  let act: (PullRequestRow.Action) -> Void

  var body: some View {
    Button("Open") { act(.openDetail) }
    Button("Open on GitHub") { act(.openInBrowser) }
    Button("Copy Link") { act(.copyURL) }
    Divider()
    if let sessionId {
      Button("Open Session") { act(.openSession(sessionId)) }
    } else {
      Button("New Session on This Branch") { act(.startSession) }
    }
  }
}

/// What a PR row's actions do, shared by the global list and the git panel's.
@MainActor
struct PullRequestActions {
  let model: DesktopModel
  let store: HostStore

  func session(for pr: RemotePullRequest) -> String? {
    store.sessionsByRepo[pr.repoRoot]?.first { $0.kind != .projectRoot && $0.branch == pr.headRef }?.id
  }

  func perform(_ action: PullRequestRow.Action, _ pr: RemotePullRequest, starting: Binding<String?>) {
    switch action {
    case .openDetail: model.navigate(.pullRequest(repo: pr.repo, number: pr.number))
    case .openInBrowser: PullRequestLinks.open(pr.url, store: store)
    case .openSession(let id): model.navigate(.session(id: id, agentId: nil))
    case .copyURL: Clipboard.copy(pr.url)
    case .startSession:
      starting.wrappedValue = pr.id
      Task {
        let session = await store.createSession(
          repoRoot: pr.repoRoot, branch: pr.headRef, description: "PR #\(pr.number): \(pr.title)\n\n\(pr.url)",
          useExistingBranch: true, baseBranch: pr.baseRef)
        starting.wrappedValue = nil
        guard let session else { return }
        await store.loadSessions(repoRoot: pr.repoRoot)
        model.navigate(.session(id: session.id, agentId: nil))
      }
    }
  }
}

/// GitHub links open through the host, which hands them to this Mac (and
/// logs instead when `ARGUS_DEV_DRY_OPEN` is set).
@MainActor
enum PullRequestLinks {
  static func open(_ url: String, store: HostStore) {
    guard let backend = store.backend else { return }
    Task {
      do {
        try await backend.request(ArgusProtocol.Commands.OpenExternalUrl.self, .init(url: url))
      } catch {
        store.report(error, scope: "pull_requests.open")
      }
    }
  }
}
