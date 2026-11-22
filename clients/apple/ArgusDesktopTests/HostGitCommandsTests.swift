import ArgusCore
import ArgusKit
import Foundation
import GroveKit
import Testing

@testable import Argus

/// Records what reached the host, then stops the command there.
@MainActor
private final class SpyHost: GitHostSending {
  struct Reached: Error {}
  private(set) var sent: [(name: String, params: [String: Any])] = []

  func send<C: RemoteCommand>(
    _ command: sending C.Type, _ params: C.Params, label: String, track: MacTelemetryEvent.GitAction?
  ) async throws -> C.Result {
    let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(params)) as? [String: Any]
    sent.append((C.name, json ?? [:]))
    throw Reached()
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
  ]

  private func commands(_ spy: SpyHost, isProjectRoot: Bool = true) -> HostGitCommands {
    HostGitCommands(
      sessionId: "s1", features: .argus(isProjectRoot: isProjectRoot, isRemote: false), host: spy,
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

  @Test func anOptionTheHostLacksIsRefusedRatherThanDropped() async {
    let spy = SpyHost()
    let pull = GitCommand.pull(
      remote: nil, branch: nil, strategy: .merge, options: PullOptions(verifySignatures: true))
    await #expect(throws: HostGitCommands.UnsupportedOption.self) { try await commands(spy).perform(pull) }
    #expect(spy.sent.isEmpty)
  }
}
