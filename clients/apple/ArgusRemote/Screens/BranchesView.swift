import ArgusUI
import SwiftUI

/// A project root's branches. Tap one to open it — history, compare, and the
/// branch actions live there.
///
/// Session worktrees are pinned to their branch, so the computer only accepts
/// branch operations on a project root — which is the only place the project
/// screen links here from.
struct BranchesView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(\.stackPush) private var stackPush

  let sessionId: String
  let repoRoot: String
  let label: String

  @State private var branches: [RemoteGitBranch] = []
  @State private var loaded = false
  @State private var filter = ""
  @State private var newBranchName = ""
  @State private var checkoutAfterCreate = true
  @State private var creating = false

  private var filtered: [RemoteGitBranch] {
    let needle = filter.trimmingCharacters(in: .whitespaces).lowercased()
    guard !needle.isEmpty else { return branches }
    return branches.filter { $0.name.lowercased().contains(needle) }
  }

  var body: some View {
    Screen {
      createForm

      ThemedTextField(placeholder: "Filter branches", text: $filter, input: .code)

      if !loaded {
        Loading(label: "Reading branches…")
      } else if filtered.isEmpty {
        EmptyState(icon: Icon.branch, title: "No branches", body: "Nothing matches that filter.")
      } else {
        section("Local", filtered.filter { $0.scope == .local })
        section("Remote only", filtered.filter { $0.scope == .remote })
      }
    }
    .navigationTitle("Branches · \(label)")
    .navigationBarTitleDisplayMode(.inline)
    .task { await refresh() }
    .refreshable { await refresh() }
  }

  @ViewBuilder
  private var createForm: some View {
    Card {
      ThemedTextField(placeholder: "new-branch-name", text: $newBranchName, input: .code)
      Toggle(isOn: $checkoutAfterCreate) {
        MutedText("Check out after creating")
      }
      .toggleStyle(.argusSwitch)
      Btn(label: creating ? "Creating…" : "Create branch", tone: .secondary, small: true) {
        create()
      }
      .disabled(creating || newBranchName.trimmingCharacters(in: .whitespaces).isEmpty)
      MutedText("Branches off whatever is checked out now.")
    }
  }

  @ViewBuilder
  private func section(_ title: String, _ items: [RemoteGitBranch]) -> some View {
    if !items.isEmpty {
      SectionHeader(title: title, count: items.count)
      ForEach(items) { branch in
        Card(onTap: {
          (stackPush ?? router.push)(.branch(sessionId: sessionId, repoRoot: repoRoot, branch: branch))
        }) {
          HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
              HStack(spacing: 6) {
                BodyText(branch.name, lineLimit: 1)
                if branch.pinned == true {
                  Image(systemName: Icon.pin)
                    .font(.caption2)
                    .foregroundStyle(theme.textMuted)
                }
                if branch.isCurrent { Badge(label: "current", tone: .accent) }
                if branch.scope == .remote { Badge(label: branch.remote ?? "remote") }
              }
              if let subject = branch.lastCommitSubject {
                MutedText(subject, lineLimit: 1)
              }
            }
            Spacer(minLength: 6)
            if branch.ahead > 0 { MutedText("↑\(branch.ahead)") }
            if branch.behind > 0 { MutedText("↓\(branch.behind)") }
          }
        }
      }
    }
  }

  private func create() {
    let name = newBranchName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    creating = true
    Task {
      await host.createBranch(
        sessionId: sessionId, repoRoot: repoRoot, name: name, checkout: checkoutAfterCreate)
      newBranchName = ""
      creating = false
      await refresh()
    }
  }

  private func refresh() async {
    let listed = await host.listBranches(sessionId: sessionId)
    // Left mid-load: an unanswered list isn't an empty one.
    guard !Task.isCancelled else { return }
    branches = listed
    loaded = true
  }
}
