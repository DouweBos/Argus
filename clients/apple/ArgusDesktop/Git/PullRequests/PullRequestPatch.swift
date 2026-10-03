import Foundation
import GroveKit

/// Turns the host's `gh pr diff` output into GroveKit `FileDiff`s with
/// GroveKit's own parser: the patch is handed in as the code host's answer,
/// since `DiffParser` and `DiffResult`'s initializer aren't public. The
/// repository is an empty scratch one: nothing is read from it.
@MainActor
enum PullRequestPatch {
  static func fileDiffs(patch: String, number: Int) async throws -> [FileDiff] {
    let repository = try await GitRepository(
      path: try scratchRepository(), runner: LocalGitRunner(), hosting: PatchHosting(patch: patch))
    return try await repository.pullRequestDiff(number: number)
  }

  private static func scratchRepository() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("argus-pr-diff", isDirectory: true)
    guard !FileManager.default.fileExists(atPath: url.appendingPathComponent(".git").path) else { return url }
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    let git = Process()
    git.executableURL = URL(fileURLWithPath: "/usr/bin/git")
    git.arguments = ["init", "-q", url.path]
    try git.run()
    git.waitUntilExit()
    return url
  }
}

/// A code host that only knows one pull request's diff.
private struct PatchHosting: RepositoryHosting {
  let patch: String

  func pullRequestHost(for remotes: [RemoteInfo]) throws -> (host: any PullRequestHost, remote: String) {
    (PatchHost(patch: patch), remotes.first?.name ?? "origin")
  }
  func ciHost(for remotes: [RemoteInfo]) throws -> any CIHost { throw HostingError.noHostedRemote }
  func service(of remotes: [RemoteInfo]) -> HostingServiceKind? { .github }
}

private nonisolated struct PatchHost: PullRequestHost {
  let patch: String
  var kind: HostingServiceKind { .github }

  func diff(number: Int) async throws -> String? { patch }

  private var unsupported: HostingError { .unsupported("Only the diff is available here.") }
  func pullRequests() async throws -> [PullRequestInfo] { throw unsupported }
  func branchPullRequests() async throws -> [BranchPullRequest] { throw unsupported }
  func pullRequest(number: Int) async throws -> PullRequestInfo { throw unsupported }
  func comments(number: Int) async throws -> [PRComment] { throw unsupported }
  func reviewComments(number: Int) async throws -> [PRReviewComment] { throw unsupported }
  func commits(number: Int) async throws -> [CommitInfo] { throw unsupported }
  func merge(number: Int) async throws { throw unsupported }
  func close(number: Int) async throws { throw unsupported }
  func updateBase(number: Int, base: String) async throws { throw unsupported }
  func comment(number: Int, body: String) async throws { throw unsupported }
  func create(_ draft: PullRequestDraft) async throws -> String { throw unsupported }
  func webURL(number: Int) async throws -> URL? { nil }
  /// GroveKit's default is main-actor isolated, which this conformance can't use.
  func headRef(number: Int) -> String? { nil }
}
