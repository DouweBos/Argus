import ArgusCore
import SwiftUI

/// Everything a branch offers, in the Mac's branch-menu order — for a row's
/// context menu. `onCompare` adds "Compare with" when the caller can show it.
public struct BranchMenuItems: View {
  let branch: RemoteGitBranch
  let actions: BranchActions
  var onCompare: (() -> Void)?

  public init(branch: RemoteGitBranch, actions: BranchActions, onCompare: (() -> Void)? = nil) {
    self.branch = branch
    self.actions = actions
    self.onCompare = onCompare
  }

  public var body: some View {
    let sections = BranchMenuSections(branch: branch, actions: actions, onCompare: onCompare)
    sections.checkout
    sections.newBranch
    Divider()
    sections.integrate
    Divider()
    sections.remote
    Divider()
    sections.manage
  }
}

/// The branch screen's actions: the obvious next step as a button, the rest
/// grouped in menus rather than a wall of buttons.
public struct BranchActionBar: View {
  @Environment(HostStore.self) private var host

  let branch: RemoteGitBranch
  let actions: BranchActions

  public init(branch: RemoteGitBranch, actions: BranchActions) {
    self.branch = branch
    self.actions = actions
  }

  private var isLocal: Bool { branch.scope == .local }

  public var body: some View {
    let sections = BranchMenuSections(branch: branch, actions: actions, onCompare: nil)
    ChipFlowLayout(spacing: 8, lineSpacing: 8) {
      if !branch.isCurrent {
        Btn(label: isLocal ? "Switch to" : "Check out locally", small: true, icon: Icon.branch, hugs: true) {
          actions.checkout(branch, host: host)
        }
        .fixedSize()
        group("Merge", icon: Icon.merge) { sections.integrate }
      }
      if isLocal || branch.upstream != nil {
        group(isLocal && branch.upstream == nil ? "Publish" : "Remote", icon: Icon.push) { sections.remote }
      }
      group("More", icon: "ellipsis") {
        sections.newBranch
        Divider()
        sections.manage
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .disabled(actions.busy)
    .opacity(actions.busy ? 0.5 : 1)
  }

  private func group<Content: View>(
    _ label: String, icon: String, @ViewBuilder content: () -> Content
  ) -> some View {
    Menu(content: content) { Chip(label: label, icon: icon) }
      .clickable()
      .accessibilityLabel(label)
  }
}

/// The menu's sections, shared by the context menu and the branch screen.
@MainActor
private struct BranchMenuSections {
  let branch: RemoteGitBranch
  let actions: BranchActions
  let onCompare: (() -> Void)?

  private var isLocal: Bool { branch.scope == .local }
  private var name: String { branch.name }

  @ViewBuilder var checkout: some View {
    BranchMenuButton(
      branch.isCurrent ? "Checked out" : isLocal ? "Switch to" : "Check out locally",
      icon: Icon.branch
    ) { host, _ in actions.checkout(branch, host: host) }
    .disabled(branch.isCurrent)
  }

  var newBranch: some View {
    BranchMenuButton("New branch from \(name)…", icon: Icon.plus) { _, _ in
      actions.newBranch(from: branch.ref)
    }
  }

  @ViewBuilder var integrate: some View {
    if !branch.isCurrent {
      BranchMenuButton("Merge into \(actions.target)", icon: Icon.merge) { _, _ in
        actions.ask(.merge(squash: false), about: branch)
      }
      BranchMenuButton("Squash into \(actions.target)", icon: "square.stack") { _, _ in
        actions.ask(.merge(squash: true), about: branch)
      }
      BranchMenuButton("Rebase \(actions.target) onto this", icon: "arrow.triangle.swap") { _, _ in
        actions.ask(.rebase, about: branch)
      }
      if let onCompare {
        BranchMenuButton("Compare with \(actions.target)", icon: "arrow.left.arrow.right") { _, _ in onCompare() }
      }
    }
  }

  @ViewBuilder var remote: some View {
    if isLocal {
      BranchMenuButton(branch.upstream == nil ? "Publish" : "Push", icon: Icon.push) { host, _ in
        actions.push(branch, host: host)
      }
      if branch.upstream != nil {
        BranchMenuButton("Force push…", icon: "exclamationmark.arrow.triangle.2.circlepath") { _, _ in
          actions.ask(.forcePush, about: branch)
        }
      }
    }
    if branch.isCurrent, branch.upstream != nil {
      Menu {
        ForEach(HostStore.PullStrategy.allCases, id: \.self) { strategy in
          BranchMenuButton(strategy.label, icon: nil) { host, _ in actions.pull(strategy, host: host) }
        }
      } label: {
        Label("Pull", systemImage: "arrow.down.circle")
      }
    }
    if branch.upstream != nil || branch.scope == .remote {
      BranchMenuButton("Open pull request", icon: Icon.pullRequest) { host, openURL in
        actions.openPullRequest(branch, host: host) { openURL($0) }
      }
    }
  }

  @ViewBuilder var manage: some View {
    if isLocal {
      BranchMenuButton(branch.pinned == true ? "Unpin" : "Pin", icon: Icon.pin) { host, _ in
        actions.setPinned(branch, host: host)
      }
      BranchMenuButton("Rename…", icon: Icon.pencil) { _, _ in actions.rename(branch) }
    }
    BranchMenuButton("Copy name", icon: "doc.on.doc") { _, _ in Clipboard.copy(name) }
    if isLocal, !branch.isCurrent {
      Divider()
      BranchMenuButton("Delete…", icon: Icon.trash, role: .destructive) { _, _ in
        actions.ask(.delete(unmerged: false), about: branch)
      }
    }
  }
}

/// A menu button that gets the host and `openURL` from wherever the menu is shown.
private struct BranchMenuButton: View {
  @Environment(HostStore.self) private var host
  @Environment(\.openURL) private var openURL

  let title: String
  let icon: String?
  var role: ButtonRole?
  let action: (HostStore, OpenURLAction) -> Void

  init(
    _ title: String, icon: String?, role: ButtonRole? = nil,
    action: @escaping (HostStore, OpenURLAction) -> Void
  ) {
    self.title = title
    self.icon = icon
    self.role = role
    self.action = action
  }

  var body: some View {
    Button(role: role) { action(host, openURL) } label: {
      if let icon { Label(title, systemImage: icon) } else { Text(title) }
    }
  }
}
