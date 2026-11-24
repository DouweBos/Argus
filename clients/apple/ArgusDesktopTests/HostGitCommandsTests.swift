import ArgusCore
import ArgusKit
import Foundation
import GroveKit
import Testing

@testable import Argus

/// Records what reached the host, then stops the command there.
@MainActor
final class SpyHost: GitHostSending {
  struct Reached: Error {}
  private(set) var sent: [(name: String, params: [String: Any])] = []
  private(set) var tracked: [MacTelemetryEvent.GitAction] = []
  /// What ran on the repository instead, by its busy label.
  private(set) var local: [String] = []
  private(set) var pushes: [GitCommand] = []

  func send<C: RemoteCommand>(
    _ command: sending C.Type, _ params: C.Params, label: String, track: MacTelemetryEvent.GitAction?
  ) async throws -> C.Result {
    let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(params)) as? [String: Any]
    sent.append((C.name, json ?? [:]))
    if let track { tracked.append(track) }
    throw Reached()
  }

  func runLocally(label: String, track: MacTelemetryEvent.GitAction?, _ work: () async throws -> Void) async throws {
    local.append(label)
    if let track { tracked.append(track) }
  }

  func track(_ action: MacTelemetryEvent.GitAction, success: Bool) {
    tracked.append(action)
  }

  func willPush(_ command: GitCommand) {
    pushes.append(command)
  }
}

@MainActor
struct HostGitCommandsTests {
  private static let hostRun: [(GitCommand, String)] = [
    (.fetch(remote: nil), "git_fetch"),
    (.pull(remote: "origin", branch: "main", strategy: .rebase, options: PullOptions()), "git_pull_v2"),
    (
      .push(remote: "origin", branch: "main", forceWithLease: true, setUpstream: false, options: PushOptions()),
      "git_push_v2"
    ),
    (.createBranch(name: "topic", from: nil, checkout: true, track: false, parent: nil), "git_create_branch"),
    (.renameBranch(from: "a", to: "b"), "git_rename_branch"),
    (.deleteBranch(name: "a", force: false), "git_delete_branch"),
    (.setUpstream(branch: "a", upstream: "origin/a"), "git_set_upstream"),
    (.checkout("main"), "git_checkout"),
    (.merge("topic", squash: true), "git_merge_branch"),
    (.rebase(onto: "main"), "git_rebase_onto"),
    (.createTag(name: "v1", at: nil, message: nil, sign: false), "git_create_tag"),
    (.deleteTag("v1"), "git_delete_tag"),
    (.pushTag("v1", remote: nil), "git_push_tag"),
    (.pushAllTags(remote: nil), "git_push_tag"),
    (.addRemote(name: "up", url: "/tmp/up"), "git_add_remote"),
    (.removeRemote("up"), "git_remove_remote"),
    (.setRemoteURL("/tmp/up", remote: "up"), "git_set_remote_url"),
    (.renameRemote(from: "up", to: "down"), "git_rename_remote"),
    (.pruneRemote("up"), "git_prune_remote"),
    (.stash(message: nil, includeUntracked: true, keepIndex: true, paths: nil), "git_stash_save"),
    (.branchFromStash(index: 1, name: "saved"), "git_stash_branch"),
    (
      .pushBranch(
        "topic", remote: "origin", as: "review", forceWithLease: true, setUpstream: true, options: PushOptions(tags: .all)),
      "git_push_v2"
    ),
    (.renameCurrentBranch(to: "renamed"), "rename_session_branch"),
    (.stashAndCheckout("main"), "git_stash_and_checkout"),
    (.discardAndCheckout("main"), "git_discard_and_checkout"),
    (.saveConflictResolution(path: "dir/a.txt", contents: "both\n"), "git_write_conflict_merged"),
  ]

  private func commands(
    _ spy: SpyHost, isProjectRoot: Bool = true, features: GitFeatures? = nil
  ) -> HostGitCommands {
    HostGitCommands(
      sessionId: "s1", features: features ?? .argus(isProjectRoot: isProjectRoot, isRemote: false), host: spy,
      repository: MockGitRepository(), naming: GitNaming(name: "grove"))
  }

  @Test func everyMutationReachesTheHost() async {
    for (command, name) in Self.hostRun {
      let spy = SpyHost()
      await #expect(throws: SpyHost.Reached.self) { try await commands(spy).perform(command) }
      #expect(spy.sent.map(\.name) == [name], "\(command)")
      #expect(spy.sent.first?.params["id"] as? String == "s1")
    }
  }

  @Test func aWorktreeSendsNothingItsFeaturesLack() async {
    let features = GitFeatures.argus(isProjectRoot: false, isRemote: false)
    for (command, _) in Self.hostRun where !command.requiredFeatures.allSatisfy(features.contains) {
      let spy = SpyHost()
      await #expect(throws: GitFeatureError.self) { try await commands(spy, isProjectRoot: false).perform(command) }
      #expect(spy.sent.isEmpty, "\(command)")
    }
  }

  @Test func aConflictsEditedResultIsWrittenThroughTheHostAndNothingElseOnFailure() async {
    let spy = SpyHost()
    let save = GitCommand.saveConflictResolution(path: "dir/a.txt", contents: "both\n")
    await #expect(throws: SpyHost.Reached.self) { try await commands(spy).perform(save) }
    // A failed write never marks the file resolved, and the view model reports the failure itself.
    #expect(spy.sent.map(\.name) == ["git_write_conflict_merged"])
    #expect(spy.sent.first?.params["filePath"] as? String == "dir/a.txt")
    #expect(spy.sent.first?.params["contents"] as? String == "both\n")
    #expect(spy.tracked.isEmpty)
  }

  @Test func pushKeepsTheLocksBranchAndPushesHead() async {
    let spy = SpyHost()
    let push = GitCommand.push(
      remote: "fork", branch: "review", forceWithLease: false, setUpstream: true, options: PushOptions(tags: .follow))
    await #expect(throws: SpyHost.Reached.self) { try await commands(spy).perform(push) }
    let params = spy.sent.first?.params
    #expect(params?["branch"] as? String == "review")
    #expect(params?["ref"] as? String == "HEAD:refs/heads/review")
    #expect(params?["tags"] as? String == "follow")
  }

  @Test func aViewModelsMutationReachesTheHostUntracked() async {
    let spy = SpyHost()
    let repository = MockGitRepository()
    let review = BranchesReviewViewModel(repository: repository)
    review.commands = HostGitCommands(
      sessionId: "s1", features: .argus(isProjectRoot: true, isRemote: false), host: ViewModelGitHost(host: spy),
      repository: repository, naming: GitNaming(name: "grove"))
    await review.refresh()
    guard let branch = review.branches.first(where: { $0.isDeletable }) else {
      Issue.record("the mock repository has no deletable branch")
      return
    }
    review.requestDelete([branch])
    guard let pending = review.pendingDelete else {
      Issue.record("nothing to confirm")
      return
    }
    await review.confirmDelete(pending)
    #expect(spy.sent.map(\.name) == ["git_delete_branch"])
    // The view model reports the action itself.
    #expect(spy.tracked.isEmpty)
    #expect(review.errorMessage != nil)
  }

  @Test func theViewModelsHostDoesNotKeepTheWorkspaceAlive() {
    var spy: SpyHost? = SpyHost()
    let sender = ViewModelGitHost(host: spy)
    weak let released = spy
    spy = nil
    #expect(released == nil)
    #expect(sender.host == nil)
  }

  /// Even with features that claim otherwise, the adapter refuses what the host can't do.
  @Test func anOptionTheHostLacksIsRefusedRatherThanDropped() async {
    let spy = SpyHost()
    let pull = GitCommand.pull(
      remote: nil, branch: nil, strategy: .merge, options: PullOptions(verifySignatures: true))
    await #expect(throws: HostGitCommands.UnsupportedOption.self) { try await commands(spy, features: .all).perform(pull) }
    let push = GitCommand.pushBranch(
      "a", remote: "o", as: "a", forceWithLease: false, setUpstream: false,
      options: PushOptions(recurseSubmodules: .check))
    await #expect(throws: HostGitCommands.UnsupportedOption.self) { try await commands(spy, features: .all).perform(push) }
    #expect(spy.sent.isEmpty)
  }

  @Test(arguments: [GitFeature.verifySignatures, .recurseSubmodules, .skipHooks, .autostash, .cancel])
  func argusLacksWhatTheHostHasNoParameterFor(_ feature: GitFeature) async {
    #expect(!GitFeatures.argus(isProjectRoot: true, isRemote: false).contains(feature))
    let spy = SpyHost()
    let pull = GitCommand.pull(remote: nil, branch: nil, strategy: .merge, options: PullOptions(verifySignatures: true))
    await #expect(throws: GitFeatureError.self) { try await commands(spy).perform(pull) }
    #expect(spy.sent.isEmpty)
  }

  @Test func pushesAreRememberedForTheBannersFixes() async {
    let spy = SpyHost()
    let push = GitCommand.pushBranch(
      "topic", remote: "fork", as: "review", forceWithLease: false, setUpstream: true, options: PushOptions())
    await #expect(throws: SpyHost.Reached.self) { try await commands(spy).perform(push) }
    #expect(spy.pushes == [push])
    #expect(spy.sent.first?.params["ref"] as? String == "refs/heads/topic:refs/heads/review")
    #expect(spy.sent.first?.params["branch"] as? String == "review")
    #expect(GitFailureBanner.destination(of: push)! == ("fork", "review"))
    #expect(
      GitFailureBanner.forced(push)
        == .pushBranch("topic", remote: "fork", as: "review", forceWithLease: true, setUpstream: true, options: PushOptions()))
  }

  @Test func whatTheHostLacksRunsLocallyAndIsTrackedOnce() async throws {
    let local: [(GitCommand, MacTelemetryEvent.GitAction)] = [
      (.fetch(remote: "fork"), .fetch), (.setUpstream(branch: "a", upstream: nil), .setUpstream),
      (.deleteRemoteBranch(name: "a", remote: "origin"), .branchDelete), (.applyStash(index: 0, drop: true), .stashPop),
      (.applyStash(index: 0, drop: false), .stashApply), (.dropStash(index: 0), .stashDrop),
      (.snapshot(message: "wip", includeUntracked: true), .snapshot),
    ]
    for (command, action) in local {
      let spy = SpyHost()
      try await commands(spy).perform(command)
      #expect(spy.sent.isEmpty && spy.local.count == 1, "\(command)")
      #expect(spy.tracked == [action], "\(command)")
    }
  }

  @Test func historysRewritesRunLocallyEvenInAWorktreeAndAreTrackedOnce() async throws {
    let rewrites: [(GitCommand, MacTelemetryEvent.GitAction)] = [
      (.cherryPick("abc"), .cherryPick), (.revert("abc"), .revert), (.reset(to: "abc", mode: .mixed), .reset),
      (.reword("abc", message: "m"), .reword), (.squash(["abc", "def"], message: "m"), .squash), (.drop("abc"), .drop),
      (.rebaseInteractive(onto: "abc", steps: []), .interactiveRebase),
    ]
    for (command, action) in rewrites {
      let spy = SpyHost()
      try await commands(spy, isProjectRoot: false).perform(command)
      #expect(spy.sent.isEmpty && spy.local.count == 1, "\(command)")
      #expect(spy.tracked == [action], "\(command)")
    }
    // A detached checkout of a commit is the host's, and a worktree session can't.
    let spy = SpyHost()
    await #expect(throws: SpyHost.Reached.self) { try await commands(spy).perform(.checkout("abc")) }
    #expect(spy.sent.map(\.name) == ["git_checkout"])
    await #expect(throws: GitFeatureError.self) { try await commands(SpyHost(), isProjectRoot: false).perform(.checkout("abc")) }
  }

  @Test func syncFetchesThroughTheHostAndIsTrackedOnce() async {
    let spy = SpyHost()
    await #expect(throws: SpyHost.Reached.self) {
      try await commands(spy).perform(.sync(remote: nil, strategy: .rebase))
    }
    #expect(spy.sent.map(\.name) == ["git_fetch"])
    #expect(spy.tracked == [.sync])
  }
}
