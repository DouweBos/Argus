import ArgusCore
import ArgusKit
import Foundation
import GroveKit
import GroveUIKit
import Testing

@testable import Argus

/// The kit's dialogs as Argus runs them: each form's commands reach the host with every option, and a
/// worktree session can't submit what its features lack.
@MainActor
struct GitDialogFormTests {
  private let local = MockData.branches.filter(\.isLocal)
  private var head: BranchInfo { local.first(where: \.isHEAD)! }
  private var topic: BranchInfo { local.first { $0.name == "feature/auth" }! }

  private func commands(_ spy: SpyHost, isProjectRoot: Bool = true) -> HostGitCommands {
    HostGitCommands(
      sessionId: "s1", features: .argus(isProjectRoot: isProjectRoot, isRemote: false), host: spy,
      repository: MockGitRepository(), naming: GitNaming(name: "grove"))
  }

  /// Each of the form's commands, sent on its own since the spy stops every one at the host.
  private func sent(_ form: some GitDialogForm) async -> [(name: String, params: [String: Any])] {
    var result: [(name: String, params: [String: Any])] = []
    for command in form.commands {
      let spy = SpyHost()
      try? await commands(spy).perform(command)
      result += spy.sent
    }
    return result
  }

  @Test func pushSendsTheTargetTagsLeaseAndUpstream() async {
    var form = GitPushForm(branch: head, isHead: true, remotes: MockData.remotes)
    form.target = "review"
    form.tags = .follow
    form.forceWithLease = true
    form.setUpstream = true
    let params = await sent(form).first?.params
    #expect(params?["branch"] as? String == "review" && params?["ref"] as? String == "HEAD:refs/heads/review")
    #expect(params?["tags"] as? String == "follow" && params?["forceWithLease"] as? Bool == true)
    #expect(params?["setUpstream"] as? Bool == true && params?["remote"] as? String == "origin")
    let other = GitPushForm(branch: topic, isHead: false, remotes: MockData.remotes)
    #expect(await sent(other).first?.params["ref"] as? String == "refs/heads/feature/auth:refs/heads/feature/auth")
  }

  @Test func pullMergeStashAndTagCarryTheirOptions() async {
    var pull = GitPullForm(
      branch: head, remoteBranches: MockData.branches.filter(\.isRemote), remotes: MockData.remotes, strategy: .rebase)
    pull.source = "upstream/main"
    let pullParams = await sent(pull).first
    #expect(pullParams?.name == "git_pull_v2" && pullParams?.params["strategy"] as? String == "rebase")
    #expect(pullParams?.params["remote"] as? String == "upstream" && pullParams?.params["branch"] as? String == "main")
    var merge = GitMergeForm(candidates: ["develop"])
    merge.squash = true
    let mergeParams = await sent(merge).first
    #expect(mergeParams?.name == "git_merge_branch" && mergeParams?.params["squash"] as? Bool == true)
    var stash = GitStashForm(paths: ["a.txt"])
    stash.keepIndex = true
    stash.includeUntracked = false
    stash.message = "wip"
    let stashParams = await sent(stash).first?.params
    #expect(stashParams?["keepIndex"] as? Bool == true && stashParams?["includeUntracked"] as? Bool == false)
    #expect(stashParams?["paths"] as? [String] == ["a.txt"] && stashParams?["message"] as? String == "wip")
    var tag = GitTagForm(target: "abc1234")
    tag.name = "v1"
    tag.annotated = true
    tag.message = "Release"
    let tagParams = await sent(tag).first?.params
    #expect(tagParams?["ref"] as? String == "abc1234" && tagParams?["message"] as? String == "Release")
  }

  @Test func everyDialogReachesTheHost() async {
    var create = GitCreateBranchForm(start: "develop", localBranches: ["develop"])
    create.name = "topic"
    var rename = GitRenameBranchForm(branch: "develop", current: "main")
    rename.name = "trunk"
    var session = GitRenameBranchForm(branch: nil, current: "main")
    session.name = "renamed"
    var delete = GitDeleteBranchForm(branch: topic)
    delete.force = true
    var track = GitTrackForm(branch: topic, remoteBranches: [], remotes: MockData.remotes)
    track.upstream = "upstream/main"
    var remote = GitRemoteForm(remote: MockData.remotes[0], existing: MockData.remotes)
    remote.name = "mine"
    remote.url = "/tmp/mine.git"
    var add = GitRemoteForm(remote: nil, existing: [])
    add.url = "/tmp/origin.git"
    var stashBranch = GitStashBranchForm(index: 1)
    stashBranch.name = "saved"
    let expected: [(any GitDialogForm, [String])] = [
      (GitFetchForm(remotes: MockData.remotes), ["git_fetch"]),
      (GitSyncForm(branch: head, remotes: MockData.remotes, strategy: .merge), ["git_fetch"]),
      (create, ["git_create_branch"]), (rename, ["git_rename_branch"]), (session, ["rename_session_branch"]),
      (delete, ["git_delete_branch"]), (track, ["git_set_upstream"]), (GitRebaseForm(candidates: ["develop"]), ["git_rebase_onto"]),
      (remote, ["git_rename_remote", "git_set_remote_url"]), (add, ["git_add_remote"]), (stashBranch, ["git_stash_branch"]),
    ]
    for (form, names) in expected {
      #expect(await sent(form).map(\.name) == names, "\(form)")
    }
  }

  @Test func aWorktreeCantSubmitWhatItsFeaturesLack() {
    let features = GitFeatures.argus(isProjectRoot: false, isRemote: false)
    var create = GitCreateBranchForm(start: "main", localBranches: ["main"])
    create.name = "x"
    var tag = GitTagForm(target: nil)
    tag.name = "v1"
    var remote = GitRemoteForm(remote: nil, existing: [])
    remote.url = "/tmp/x"
    var rename = GitRenameBranchForm(branch: "develop", current: "main")
    rename.name = "y"
    let refused: [any GitDialogForm] = [
      create, tag, remote, rename, GitMergeForm(candidates: ["develop"]), GitRebaseForm(candidates: ["develop"]),
      GitDeleteBranchForm(branch: topic),
    ]
    for form in refused {
      #expect(form.unsupportedReason(features) == "Only in the project root", "\(form)")
    }
    var session = GitRenameBranchForm(branch: nil, current: "main")
    session.name = "renamed"
    let allowed: [any GitDialogForm] = [
      GitPushForm(branch: head, isHead: true, remotes: MockData.remotes), GitStashForm(), session,
      GitSnapshotForm(branch: "main"), GitSyncForm(branch: head, remotes: MockData.remotes, strategy: .merge),
    ]
    for form in allowed {
      #expect(form.unsupportedReason(features) == nil, "\(form)")
    }
  }

  @Test func theDialogsAreClosedIntoTelemetry() {
    let presenter = GitDialogPresenter.argus()
    #expect(presenter.onClose != nil)
  }
}
