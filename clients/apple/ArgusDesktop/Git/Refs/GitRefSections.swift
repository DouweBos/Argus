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
      Section {
        ForEach(pinned) { BranchRow(branch: $0, actions: actions) }
      } header: {
        SectionLabel("Pinned", count: pinned.count)
      }
    }
    Section {
      ForEach(top) { BranchRow(branch: $0, actions: actions) }
      ForEach(tree) { BranchFolderRow(node: $0, actions: actions, expanded: $expanded) }
    } header: {
      SectionLabel("Branches", count: local.count)
        .contextMenu { Button("New Branch…") { actions.newBranch() } }
        .task(id: workspace.generation) {
          await marks.load(repoRoot: session.repoRoot, backend: model.store.backend)
        }
        .onChange(of: actions.currentBranch?.name, initial: true) { _, name in
          if let name { expanded.formUnion(BranchTreeNode.ancestors(of: name)) }
        }
    }
    if !marks.archived.isEmpty {
      Section {
        ForEach(marks.archived, id: \.self) { name in archivedRow(name, actions: actions) }
      } header: {
        SectionLabel("Archived", count: marks.archived.count)
      }
    }
    Section {
      ForEach(refs.remotes) { remote in remoteGroup(remote, actions: actions) }
    } header: {
      SectionLabel("Remotes", count: refs.remotes.count).contextMenu { Button("Add Remote…") { actions.addRemote() } }
    }
    if !refs.tags.isEmpty {
      // Collapsed until asked for, as Electron's: thousands of tag rows make opening the panel slow.
      Section {
        if workspace.tagsExpanded {
          ForEach(refs.tags) { TagRow(tag: $0, actions: actions) }
        }
      } header: {
        Button {
          workspace.tagsExpanded.toggle()
        } label: {
          HStack(spacing: 4) {
            SectionLabel("Tags", count: refs.tags.count)
            Image(systemName: workspace.tagsExpanded ? "chevron.down" : "chevron.right")
              .font(.scaled(size: 8, weight: .semibold))
              .foregroundStyle(theme.textMuted)
            Spacer(minLength: 0)
          }
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help(workspace.tagsExpanded ? "Hide tags" : "Show tags")
      }
    }
    if !refs.submodules.isEmpty {
      Section {
        ForEach(refs.submodules) { submodule in
          GitRefLabel(submodule.path, systemImage: submodule.state == .upToDate ? "shippingbox" : "shippingbox.fill")
            .help(submodule.url ?? submodule.path)
            .gitSidebarRow(.view(GitRoute.submodules.segment))
        }
      } header: {
        SectionLabel("Submodules", count: refs.submodules.count)
      }
    }
    if refs.worktrees.count > 1 {
      Section {
        ForEach(refs.worktrees) { worktreeRow($0) }
      } header: {
        SectionLabel("Worktrees", count: refs.worktrees.count)
      }
    }
  }

  private func archivedRow(_ name: String, actions: RefActions) -> some View {
    let exists = refs.localBranches.contains { $0.name == name }
    return GitRefLabel(name, systemImage: "archivebox")
      .foregroundStyle(exists ? theme.textSecondary : theme.textMuted)
      .help(exists ? name : "\(name) no longer exists")
      .gitSidebarRow(.branch(name))
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
      HStack {
        GitRefLabel(remote.name, systemImage: "network")
        Spacer(minLength: 4)
        Text(branches.count, format: .number)
          .font(.scaled(size: 10).monospacedDigit())
          .foregroundStyle(theme.textMuted)
      }
      .contentShape(.rect)
      .modifier(NavigatorRowHighlight(selected: false))
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
    GitRefLabel(
      worktree.branch ?? "Detached", systemImage: worktree.isMain ? "folder.fill" : "folder"
    )
    .foregroundStyle(worktree.isPrunable ? theme.textMuted : theme.text)
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(.rect)
    .modifier(NavigatorRowHighlight(selected: false))
    .help(worktree.path)
    .contextMenu {
      Button("Reveal in Finder") { NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: worktree.path) }
      Button("Copy Path") { Clipboard.copy(worktree.path) }
    }
  }
}
