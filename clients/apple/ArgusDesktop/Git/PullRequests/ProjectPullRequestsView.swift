import ArgusUI
import GroveKit
import SwiftUI

/// The git panel's Pull Requests: the PRs of interest in this project only,
/// and opening a new one for a session branch.
struct ProjectPullRequestsView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let repoRoot: String
  @State private var creating = false
  @State private var refreshing = false

  private var prs: PullRequestsStore { model.pullRequests }
  private var mine: [RemotePullRequest] { prs.pullRequests.filter { $0.repoRoot == repoRoot } }

  /// Worktree sessions with a branch and base to open a PR from.
  private var sessions: [RemoteSession] {
    (store.sessionsByRepo[repoRoot] ?? []).filter { $0.kind != .projectRoot && $0.baseBranch != nil }
  }

  var body: some View {
    VStack(spacing: 0) {
      GitToolHeader(title: "Pull Requests", caption: caption) {
        Button { Task { await refresh() } } label: { Image(systemName: "arrow.clockwise") }
          .help("Refresh")
          .disabled(refreshing)
        Button("New Pull Request…") { creating = true }
          .disabled(sessions.isEmpty)
          .help(sessions.isEmpty ? "Create a session to open a pull request from its branch" : "")
      }
      Divider()
      PullRequestList(
        pullRequests: mine, loaded: prs.loaded, error: prs.error, showsRepo: false,
        emptyTitle: "No open pull requests",
        emptyText: "When this project has open PRs that involve you, they'll show up here."
      ) { Task { await refresh() } }
    }
    .task { await refresh() }
    .sheet(isPresented: $creating) {
      NewPullRequestSheet(repoRoot: repoRoot, sessions: sessions)
    }
  }

  private var caption: String? {
    guard prs.loaded else { return nil }
    return "\(mine.count) open · authored, reviewing, or commented\(refreshing ? " · refreshing…" : "")"
  }

  private func refresh() async {
    refreshing = true
    await prs.refresh()
    refreshing = false
  }
}

/// Title, body (from the repo's template, or filled in by Claude), draft, then
/// push the branch and open the PR on GitHub.
private struct NewPullRequestSheet: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  let repoRoot: String
  let sessions: [RemoteSession]

  @State private var sessionId = ""
  @State private var title = ""
  @State private var bodyText = ""
  @State private var draft = false
  @State private var busy: String?
  @State private var error: String?
  @State private var createdURL: String?
  @State private var confirming = false

  private var session: RemoteSession? { sessions.first { $0.id == sessionId } }

  var body: some View {
    Form {
      if let createdURL {
        Section {
          Label("Pull request opened", systemImage: "checkmark.circle").font(.scaled(.headline))
          Text(createdURL).font(.scaled(size: 12, design: .monospaced)).textSelection(.enabled)
          HStack {
            Button("Open on GitHub") { PullRequestLinks.open(createdURL, store: store) }
            Button("Copy Link") { Clipboard.copy(createdURL) }
          }
        }
      } else {
        fields
      }
      if let error {
        Text(error).foregroundStyle(.secondary).textSelection(.enabled)
      }
    }
    .formStyle(.grouped)
    .toggleStyle(.argusSwitch)
    .safeAreaInset(edge: .top) {
      Text("New Pull Request").font(.scaled(.headline)).frame(maxWidth: .infinity, alignment: .leading)
        .padding([.top, .horizontal], 20)
    }
    .frame(width: 560, height: createdURL == nil ? 560 : 260)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button(createdURL == nil ? "Cancel" : "Done") { dismiss() }
      }
      if createdURL == nil {
        ToolbarItem(placement: .confirmationAction) {
          Button(busy ?? "Open Pull Request") { confirming = true }
            .disabled(busy != nil || session == nil || title.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
    }
    .confirmationDialog("Open this pull request on GitHub?", isPresented: $confirming) {
      Button(draft ? "Push and Open Draft" : "Push and Open") { create() }
    } message: {
      Text("\(session?.branch ?? "") is pushed, then a PR into \(session?.baseBranch ?? "") is opened as you.")
    }
    .task {
      sessionId = sessions.first?.id ?? ""
      if case .success(let template?) = await GitToolRead.request(
        store, ArgusProtocol.Commands.ReadPrTemplate.self, .init(repoRoot: repoRoot)), bodyText.isEmpty
      {
        bodyText = template
      }
    }
  }

  @ViewBuilder
  private var fields: some View {
    Section {
      Picker("Session", selection: $sessionId) {
        ForEach(sessions, id: \.id) { session in
          Text(session.displayName ?? session.branch).tag(session.id)
        }
      }
      if let session {
        LabeledContent("Branches", value: "\(session.branch) → \(session.baseBranch ?? "")")
      }
      TextField("Title", text: $title, prompt: Text("Pull request title"))
      Toggle("Open as draft", isOn: $draft)
    }
    Section {
      TextEditor(text: $bodyText)
        .font(.scaled(size: 12, design: .monospaced))
        .frame(minHeight: 180)
    } header: {
      HStack {
        Text("Description")
        Spacer()
        Button("Fill In with Claude") { autofill() }
          .buttonStyle(.argusBorderless)
          .controlSize(.small)
          .disabled(busy != nil || session == nil)
      }
    }
  }

  private func autofill() {
    guard let session, let backend = store.backend else { return }
    busy = "Filling in…"
    error = nil
    Task {
      defer { busy = nil }
      do {
        let filled = try await backend.request(
          ArgusProtocol.Commands.AutofillPrTemplate.self,
          .init(
            sessionId: session.id, title: title.isEmpty ? session.branch : title,
            baseBranch: session.baseBranch ?? "main"))
        if let filled { bodyText = filled } else {
          error = "Claude couldn't fill in the description. Check that `claude` is installed and signed in."
        }
      } catch {
        self.error = HostStore.describe(error)
      }
    }
  }

  private func create() {
    guard let session, let backend = store.backend else { return }
    error = nil
    Task {
      defer { busy = nil }
      busy = "Pushing…"
      do {
        _ = try await backend.request(ArgusProtocol.Commands.PushSessionBranch.self, .init(id: session.id))
      } catch {
        self.error = "Couldn't push \(session.branch) — \(HostStore.describe(error))"
        return
      }
      busy = "Opening…"
      if let url = await model.pullRequests.create(
        sessionId: session.id, title: title.trimmingCharacters(in: .whitespaces), body: bodyText, draft: draft)
      {
        createdURL = url
      } else {
        error = model.pullRequests.error
      }
    }
  }
}
