import ArgusUI
import GroveKit
import SwiftUI

/// A local branch: checked-out mark, ahead/behind its upstream, protected lock.
struct BranchRow: View {
  @Environment(\.theme) private var theme
  let branch: BranchInfo
  var title: String?
  let actions: RefActions

  var body: some View {
    let marks = actions.marks
    HStack(spacing: 6) {
      Image(systemName: branch.isHEAD ? "checkmark.circle.fill" : "arrow.triangle.branch")
        .foregroundStyle(branch.isHEAD ? theme.accent : theme.textSecondary)
        .frame(width: 16)
      Text(title ?? branch.name)
        .fontWeight(branch.isHEAD ? .semibold : .regular)
        .lineLimit(1)
        .truncationMode(.middle)
      Spacer(minLength: 4)
      if marks.isPinned(branch.name) {
        Image(systemName: "pin.fill").font(.scaled(size: 9)).foregroundStyle(theme.textMuted)
      }
      if marks.isProtected(branch.name) {
        Image(systemName: "lock.fill").font(.scaled(size: 9)).foregroundStyle(theme.textMuted)
          .help("Protected branch")
      }
      AheadBehindLabel(ahead: branch.ahead, behind: branch.behind)
    }
    .help(branch.upstream.map { "\(branch.name) → \($0)" } ?? branch.name)
    .font(.sidebarScaled(.body))
    .accessibilityLabel(branch.name)
    .tag(GitSidebarTag.branch(branch.name))
    .contextMenu { BranchMenu(branch: branch, actions: actions) }
  }
}

/// `↑2 ↓1`, hidden when level.
struct AheadBehindLabel: View {
  @Environment(\.theme) private var theme
  let ahead: Int
  let behind: Int

  var body: some View {
    if ahead > 0 || behind > 0 {
      HStack(spacing: 3) {
        if ahead > 0 { Text("↑\(ahead)") }
        if behind > 0 { Text("↓\(behind)") }
      }
      .font(.scaled(size: 10, weight: .medium).monospacedDigit())
      .foregroundStyle(theme.textSecondary)
      .help("\(ahead) ahead, \(behind) behind")
    }
  }
}

/// Everything a local branch offers, as Electron's branch context menu.
struct BranchMenu: View {
  let branch: BranchInfo
  let actions: RefActions

  var body: some View {
    let name = branch.name
    let marks = actions.marks
    let current = actions.currentName
    Button(branch.isHEAD ? "Already Checked Out" : "Checkout") { Task { await actions.checkout(name) } }
      .disabled(branch.isHEAD)
    Button("New Branch from \(name)…") { actions.newBranch(from: name) }
    Divider()
    Button("Merge \(name) into \(current)") { Task { await actions.merge(name) } }.disabled(branch.isHEAD)
    Button("Squash-Merge \(name) into \(current)") { Task { await actions.merge(name, squash: true) } }
      .disabled(branch.isHEAD)
    Button("Rebase \(current) onto \(name)") { Task { await actions.rebaseCurrent(onto: name) } }
      .disabled(branch.isHEAD)
    Button("Compare with \(current)") { actions.compareWithCurrent(name) }.disabled(branch.isHEAD)
    Divider()
    Button(branch.upstream == nil ? "Publish…" : "Push…") { actions.push(branch) }
    if branch.isHEAD { Button("Pull…") { Task { await actions.pull() } } }
    Button("Set Upstream…") { actions.setUpstream(branch) }
    Button("Create Pull Request") { actions.createPullRequest() }
    Divider()
    Button(marks.isPinned(name) ? "Unpin" : "Pin") { Task { await actions.setPinned(name, !marks.isPinned(name)) } }
    Button(marks.isArchived(name) ? "Unarchive" : "Archive") {
      Task { await actions.setArchived(name, !marks.isArchived(name)) }
    }
    .disabled(branch.isHEAD)
    Button("Rename…") { actions.rename(name) }
    Button("Copy Name") { Clipboard.copy(name) }
    Divider()
    Button("Delete…", role: .destructive) { Task { await actions.delete(name) } }.disabled(branch.isHEAD)
  }
}

/// A folder of branches (`feature/…`), expandable.
struct BranchFolderRow: View {
  let node: BranchTreeNode
  let actions: RefActions
  @Binding var expanded: Set<String>

  var body: some View {
    if let branch = node.branch {
      BranchRow(branch: branch, title: node.title, actions: actions)
    } else {
      DisclosureGroup(isExpanded: binding) {
        ForEach(node.children) { child in
          BranchFolderRow(node: child, actions: actions, expanded: $expanded)
        }
      } label: {
        SidebarLabel(node.title, systemImage: "folder")
      }
    }
  }

  private var binding: Binding<Bool> {
    Binding(
      get: { expanded.contains(node.id) },
      set: { open in
        if open { expanded.insert(node.id) } else { expanded.remove(node.id) }
      })
  }
}

/// A remote-tracking branch.
struct RemoteBranchRow: View {
  @Environment(\.theme) private var theme
  let branch: BranchInfo
  let actions: RefActions

  var body: some View {
    let local = RefActions.localName(of: branch)
    Label {
      Text(local).lineLimit(1).truncationMode(.middle)
    } icon: {
      Image(systemName: "arrow.triangle.branch").foregroundStyle(theme.textSecondary)
    }
    .font(.sidebarScaled(.body))
    .accessibilityLabel(branch.name)
    .tag(GitSidebarTag.branch(branch.name))
    .contextMenu {
      Button("Checkout as \(local)") { Task { await actions.checkoutRemote(branch) } }
      Button("New Branch from \(branch.name)…") { actions.newBranch(from: branch.name) }
      Button("Merge into \(actions.currentName)") { Task { await actions.merge(branch.name) } }
      Button("Compare with \(actions.currentName)") { actions.compareWithCurrent(branch.name) }
      Button("Copy Name") { Clipboard.copy(branch.name) }
      Divider()
      Button("Delete from Remote…", role: .destructive) { Task { await actions.deleteRemoteBranch(branch) } }
    }
  }
}

/// A tag; selecting it shows its history.
struct TagRow: View {
  @Environment(\.theme) private var theme
  let tag: TagInfo
  let actions: RefActions

  var body: some View {
    Label {
      Text(tag.name).lineLimit(1)
    } icon: {
      Image(systemName: tag.isAnnotated ? "tag.fill" : "tag").foregroundStyle(theme.textSecondary)
    }
    .font(.sidebarScaled(.body))
    .accessibilityLabel(tag.name)
    .tag(GitSidebarTag.tag(tag.name))
    .contextMenu {
      Button("Checkout") { Task { await actions.checkout(tag.name) } }
      Button("New Branch from \(tag.name)…") { actions.newBranch(from: tag.name) }
      Button("Compare with \(actions.currentName)") { actions.compareWithCurrent(tag.name) }
      Button("Push to \(actions.remoteNames.first ?? "Remote")") { Task { await actions.pushTag(tag.name) } }
        .disabled(actions.remoteNames.isEmpty)
      Button("Copy Name") { Clipboard.copy(tag.name) }
      Divider()
      Button("Delete…", role: .destructive) { Task { await actions.deleteTag(tag.name) } }
    }
  }
}
