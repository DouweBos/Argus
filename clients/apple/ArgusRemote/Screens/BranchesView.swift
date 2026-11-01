import ArgusUI
import SwiftUI

/// A project root's branches, as the Mac's branch list: long-press a row for
/// its menu, swipe for the common moves, `+` for a new branch, tap to open it.
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
  @State private var actions: BranchActions

  init(sessionId: String, repoRoot: String, label: String) {
    self.sessionId = sessionId
    self.repoRoot = repoRoot
    self.label = label
    _actions = State(initialValue: BranchActions(sessionId: sessionId, repoRoot: repoRoot))
  }

  private var filtered: [RemoteGitBranch] {
    let needle = filter.trimmingCharacters(in: .whitespaces).lowercased()
    guard !needle.isEmpty else { return branches }
    return branches.filter { $0.name.lowercased().contains(needle) }
  }

  var body: some View {
    List {
      section("Local", filtered.filter { $0.scope == .local })
      section("Remote only", filtered.filter { $0.scope == .remote })
    }
    .loadPhase(
      LoadPhase(loaded: loaded, error: nil, isEmpty: filtered.isEmpty), loading: "Reading branches…"
    ) {
      EmptyState(
        icon: Icon.branch, title: "No branches",
        body: branches.isEmpty ? "This repository has no branches yet." : "Nothing matches that filter.")
    }
    .screenSearch(text: $filter, prompt: "Filter branches")
    .autocorrectionDisabled()
    .textInputAutocapitalization(.never)
    .navigationTitle("Branches · \(label)")
    .navigationBarTitleDisplayMode(.inline)
    .screenBar {
      if host.hasControl {
        Button { actions.newBranch() } label: { Label("New branch", systemImage: Icon.plus) }
          .disabled(actions.busy)
      }
    }
    .branchActionPrompts(actions)
    .task {
      actions.onChanged = { await refresh() }
      await refresh()
    }
    .refreshable { await refresh() }
  }

  @ViewBuilder
  private func section(_ title: String, _ items: [RemoteGitBranch]) -> some View {
    if !items.isEmpty {
      Section("\(title) · \(items.count)") {
        ForEach(items) { branch in
          StackLink(route: .branch(sessionId: sessionId, repoRoot: repoRoot, branch: branch)) {
            BranchRow(branch: branch)
          }
          .contextMenu {
            if host.hasControl {
              BranchMenuItems(branch: branch, actions: actions) { compare(branch) }
            }
          }
          .swipeActions(edge: .leading) { leadingSwipe(branch) }
          .swipeActions(edge: .trailing) { trailingSwipe(branch) }
        }
      }
    }
  }

  /// The one-tap way forward: switch to it, or push the current one.
  @ViewBuilder
  private func leadingSwipe(_ branch: RemoteGitBranch) -> some View {
    if host.hasControl {
      if !branch.isCurrent {
        Button(branch.scope == .local ? "Switch" : "Check out", systemImage: Icon.branch) {
          actions.checkout(branch, host: host)
        }
        .tint(theme.accent)
      } else if branch.scope == .local {
        Button(branch.upstream == nil ? "Publish" : "Push", systemImage: Icon.push) {
          actions.push(branch, host: host)
        }
        .tint(theme.accent)
      }
    }
  }

  @ViewBuilder
  private func trailingSwipe(_ branch: RemoteGitBranch) -> some View {
    if host.hasControl, branch.scope == .local {
      if !branch.isCurrent {
        // Asks first; a full swipe never deletes on its own.
        Button("Delete", systemImage: Icon.trash) { actions.ask(.delete(unmerged: false), about: branch) }
          .tint(theme.error)
      }
      Button(branch.pinned == true ? "Unpin" : "Pin", systemImage: Icon.pin) {
        actions.setPinned(branch, host: host)
      }
      .tint(theme.textMuted)
    }
  }

  private func compare(_ branch: RemoteGitBranch) {
    guard let current = actions.current else { return }
    (stackPush ?? router.push)(.branchCompare(sessionId: sessionId, left: current, right: branch.ref))
  }

  private func refresh() async {
    let listed = await host.listBranches(sessionId: sessionId)
    // Left mid-load: an unanswered list isn't an empty one.
    guard !Task.isCancelled else { return }
    branches = listed
    actions.branches = listed
    actions.current = listed.first(where: \.isCurrent)?.name
    loaded = true
  }
}

/// A branch in the list: its name and marks, the last commit, ahead/behind.
private struct BranchRow: View {
  @Environment(\.theme) private var theme
  let branch: RemoteGitBranch

  var body: some View {
    HStack(spacing: 8) {
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          BodyText(branch.name, lineLimit: 1)
          if branch.pinned == true {
            Image(systemName: Icon.pin)
              .font(.caption2)
              .foregroundStyle(theme.textMuted)
              .accessibilityLabel("Pinned")
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
