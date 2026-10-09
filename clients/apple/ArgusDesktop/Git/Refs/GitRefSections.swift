import AppKit
import ArgusUI
import GroveKit
import SwiftUI

/// The project's branches, tags, remotes, submodules and worktrees in the git sidebar.
struct GitRefSections: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  let session: RemoteSession
  let view: GitRoute
  @State private var expanded: Set<String> = []

  private var refs: RepositoryRefs { workspace.refs }

  var body: some View {
    let actions = RefActions(workspace: workspace, session: session, model: model, theme: theme)
    let marks = actions.marks
    let local = refs.localBranches.filter { !marks.isArchived($0.name) }
    let pinned = refs.localBranches.filter { marks.isPinned($0.name) }
    // Protected and the default base sit above the tree, as Electron pins the default branch.
    let top = local.filter { marks.isProtected($0.name) || $0.name == marks.defaultBase }
    let topNames = Set(top.map(\.name))
    let tree = BranchTreeNode.build(local.filter { !topNames.contains($0.name) })

    if !pinned.isEmpty {
      Section("Pinned") {
        ForEach(pinned) { BranchRow(branch: $0, actions: actions) }
      }
    }
    Section {
      ForEach(top) { BranchRow(branch: $0, actions: actions) }
      ForEach(tree) { BranchFolderRow(node: $0, actions: actions, expanded: $expanded) }
    } header: {
      Text("Branches")
        .contextMenu { Button("New Branch…") { actions.newBranch() } }
        .task(id: workspace.generation) {
          await marks.load(repoRoot: session.repoRoot, backend: model.store.backend)
        }
        .onChange(of: actions.currentBranch?.name, initial: true) { _, name in
          if let name { expanded.formUnion(BranchTreeNode.ancestors(of: name)) }
        }
    }
    if !marks.archived.isEmpty {
      Section("Archived") {
        ForEach(marks.archived, id: \.self) { name in archivedRow(name, actions: actions) }
      }
    }
    if !refs.tags.isEmpty {
      // Collapsed until asked for, as Electron's: thousands of tag rows make opening the panel slow.
      Section(isExpanded: Binding(get: { workspace.tagsExpanded }, set: { workspace.tagsExpanded = $0 })) {
        ForEach(refs.tags) { TagRow(tag: $0, actions: actions) }
      } header: {
        HStack {
          Text("Tags")
          Spacer()
          Text(refs.tags.count, format: .number).foregroundStyle(theme.textMuted).monospacedDigit()
        }
      }
    }
    Section {
      ForEach(refs.remotes) { remote in remoteGroup(remote, actions: actions) }
    } header: {
      Text("Remotes").contextMenu { Button("Add Remote…") { actions.addRemote() } }
    }
    if !refs.submodules.isEmpty {
      Section("Submodules") {
        ForEach(refs.submodules) { submodule in
          SidebarLabel(submodule.path, systemImage: submodule.state == .upToDate ? "shippingbox" : "shippingbox.fill")
            .help(submodule.url ?? submodule.path)
            .tag(GitSidebarTag.view(GitRoute.submodules.segment))
        }
      }
    }
    if refs.worktrees.count > 1 {
      Section("Worktrees") {
        ForEach(refs.worktrees) { worktreeRow($0) }
      }
    }
  }

  private func archivedRow(_ name: String, actions: RefActions) -> some View {
    let exists = refs.localBranches.contains { $0.name == name }
    return SidebarLabel(name, systemImage: "archivebox")
      .foregroundStyle(exists ? theme.textSecondary : theme.textMuted)
      .help(exists ? name : "\(name) no longer exists")
      .tag(GitSidebarTag.branch(name))
      .contextMenu {
        Button("Checkout") { Task { await actions.checkout(name) } }.disabled(!exists)
        Button("Unarchive") { Task { await actions.setArchived(name, false) } }
      }
  }

  private func remoteGroup(_ remote: RemoteInfo, actions: RefActions) -> some View {
    let key = "remote:\(remote.name)"
    let branches = refs.remoteBranches.filter { $0.remoteName == remote.name && !$0.name.hasSuffix("/HEAD") }
    return DisclosureGroup(
      isExpanded: Binding(
        get: { expanded.contains(key) },
        set: { open in
          if open { expanded.insert(key) } else { expanded.remove(key) }
        })
    ) {
      ForEach(branches) { RemoteBranchRow(branch: $0, actions: actions) }
    } label: {
      SidebarLabel(remote.name, systemImage: "network")
        .help(remote.url)
        .contextMenu {
          Button("Fetch \(remote.name)") { Task { await actions.fetch(remote: remote.name) } }
          Button("Prune Stale Branches") { Task { await actions.pruneRemote(remote.name) } }
          Divider()
          Button("Rename…") { actions.renameRemote(remote.name) }
          Button("Set URL…") { actions.setRemoteURL(remote) }
          Button("Copy URL") { Clipboard.copy(remote.url) }
          Divider()
          Button("Add Remote…") { actions.addRemote() }
          Button("Remove…", role: .destructive) { Task { await actions.removeRemote(remote.name) } }
        }
    }
  }

  private func worktreeRow(_ worktree: WorktreeInfo) -> some View {
    SidebarLabel(
      worktree.branch ?? "Detached", systemImage: worktree.isMain ? "folder.fill" : "folder"
    )
    .foregroundStyle(worktree.isPrunable ? theme.textMuted : theme.text)
    .help(worktree.path)
    .contextMenu {
      Button("Reveal in Finder") { NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: worktree.path) }
      Button("Copy Path") { Clipboard.copy(worktree.path) }
    }
  }
}
