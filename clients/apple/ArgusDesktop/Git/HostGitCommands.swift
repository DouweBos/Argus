import ArgusCore
import ArgusKit
import Foundation
import GroveKit

/// Sends one of the host's typed git commands; `GitWorkspace` in the app, a spy in tests.
@MainActor
protocol GitHostSending {
  func send<C: RemoteCommand>(
    _ command: sending C.Type, _ params: C.Params, label: String, track: MacTelemetryEvent.GitAction?
  ) async throws -> C.Result
}

/// The kit's commands through the host's, which hold the locks and the project's rules.
/// What the host has no command for runs on the repository.
@MainActor
struct HostGitCommands: GitCommandPerforming {
  let sessionId: String
  let features: GitFeatures
  let host: any GitHostSending
  let repository: any GitRepositoryProtocol
  let naming: GitNaming

  private typealias Host = ArgusProtocol.Commands

  struct UnsupportedOption: LocalizedError, Equatable {
    let option: String
    var errorDescription: String? { "Argus can't \(option). Turn it off and try again." }
  }

  func perform(_ command: GitCommand, progress: (@Sendable (Double) -> Void)?) async throws {
    try requireSupport(for: command)
    let id = sessionId
    switch command {
    case .fetch(nil):
      _ = try await host.send(Host.GitFetch.self, .init(id: id), label: "Fetching", track: .fetch)
    case .pull(let remote, let branch, let strategy, let options):
      if options.verifySignatures { throw UnsupportedOption(option: "verify signatures when pulling") }
      _ = try await host.send(
        Host.GitPullV2.self, .init(id: id, strategy: strategy.wire, remote: remote, branch: branch), label: "Pulling",
        track: .pull)
    case .push(let remote, let branch, let lease, let setUpstream, let options):
      if options.recurseSubmodules != nil { throw UnsupportedOption(option: "push submodules along") }
      // `branch` is what the host's push lock checks; `ref` is what it pushes, whatever the local branch is called.
      _ = try await host.send(
        Host.GitPushV2.self,
        .init(
          id: id, remote: remote, branch: branch, forceWithLease: lease, setUpstream: setUpstream,
          tags: .init(rawValue: options.tags.rawValue), ref: "HEAD:refs/heads/\(branch)"),
        label: "Pushing", track: .push)
    case .createBranch(let name, let start, let checkout, let track, let parent):
      _ = try await host.send(
        Host.GitCreateBranch.self, .init(id: id, name: name, startPoint: start, checkout: checkout),
        label: "Creating \(name)", track: .branchCreate)
      if track, let start { try await repository.setUpstream(of: name, to: start) }
      if let parent, !parent.isEmpty {
        try await repository.setLocalConfigValue("branch.\(name).\(naming.parentKey)", to: parent)
      }
    case .renameBranch(let old, let new):
      _ = try await host.send(
        Host.GitRenameBranch.self, .init(id: id, from: old, to: new), label: "Renaming \(old)", track: .branchRename)
    case .deleteBranch(let name, let force):
      _ = try await host.send(
        Host.GitDeleteBranch.self, .init(id: id, name: name, force: force), label: "Deleting \(name)",
        track: .branchDelete)
    case .setUpstream(let branch, let upstream?):
      _ = try await host.send(
        Host.GitSetUpstream.self, .init(id: id, branch: branch, upstream: upstream), label: "Setting upstream",
        track: .setUpstream)
    case .checkout(let name):
      _ = try await host.send(
        Host.GitCheckout.self, .init(id: id, branch: name), label: "Checking out \(name)", track: .checkout)
    case .merge(let branch, let squash):
      _ = try await host.send(
        Host.GitMergeBranch.self, .init(id: id, from: branch, squash: squash), label: "Merging \(branch)",
        track: .merge)
    case .rebase(let upstream):
      _ = try await host.send(
        Host.GitRebaseOnto.self, .init(id: id, upstream: upstream), label: "Rebasing onto \(upstream)", track: .rebase)
    case .createTag(let name, let sha, let message, let sign):
      _ = try await host.send(
        Host.GitCreateTag.self, .init(id: id, name: name, ref: sha, message: message, sign: sign),
        label: "Tagging \(name)", track: .tagCreate)
    case .deleteTag(let name):
      _ = try await host.send(
        Host.GitDeleteTag.self, .init(id: id, name: name), label: "Deleting \(name)", track: .tagDelete)
    case .pushTag(let name, let remote):
      _ = try await host.send(
        Host.GitPushTag.self, .init(id: id, name: name, remote: remote), label: "Pushing \(name)", track: .push)
    case .pushAllTags(let remote):
      _ = try await host.send(
        Host.GitPushTag.self, .init(id: id, all: true, remote: remote), label: "Pushing tags", track: .push)
    case .addRemote(let name, let url):
      _ = try await host.send(
        Host.GitAddRemote.self, .init(id: id, name: name, url: url), label: "Adding \(name)", track: .remote)
    case .removeRemote(let name):
      _ = try await host.send(
        Host.GitRemoveRemote.self, .init(id: id, name: name), label: "Removing \(name)", track: .remote)
    case .setRemoteURL(let url, let remote):
      _ = try await host.send(
        Host.GitSetRemoteUrl.self, .init(id: id, name: remote, url: url), label: "Setting URL", track: .remote)
    case .renameRemote(let old, let new):
      _ = try await host.send(
        Host.GitRenameRemote.self, .init(id: id, from: old, to: new), label: "Renaming \(old)", track: .remote)
    case .pruneRemote(let name):
      _ = try await host.send(
        Host.GitPruneRemote.self, .init(id: id, name: name), label: "Pruning \(name)", track: .remote)
    case .stash(let message, let untracked, let keepIndex, let paths):
      _ = try await host.send(
        Host.GitStashSave.self,
        .init(id: id, includeUntracked: untracked, keepIndex: keepIndex, message: message, paths: paths),
        label: "Stashing", track: .stashCreate)
    case .branchFromStash(let index, let name):
      _ = try await host.send(
        Host.GitStashBranch.self, .init(id: id, stashRef: "stash@{\(index)}", branchName: name),
        label: "Creating \(name)", track: .branchCreate)
    case .fetch, .setUpstream, .deleteRemoteBranch, .applyStash, .dropStash, .snapshot:
      // One remote, unsetting an upstream and the stash list: the host has no command for these.
      try await RepositoryCommands(repository: repository, features: features).perform(command, progress: progress)
    default:
      // Not sent to the host yet; the views that run these still call the repository.
      try await RepositoryCommands(repository: repository, features: features).perform(command, progress: progress)
    }
  }
}
