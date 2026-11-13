import ArgusUI
import Foundation
import GroveKit
import Observation

/// One pull or merge request's full detail and diff from the host's code-host service,
/// and the writes (comment, merge, close) on it.
@MainActor
@Observable
final class PullRequestDetailModel {
  let repo: String
  let number: Int
  private(set) var detail: ArgusProtocol.PullRequestDetail?
  private(set) var loadError: String?
  private(set) var files: [FileDiff] = []
  private(set) var diffLoaded = false
  private(set) var diffError: String?
  /// The last write that failed, for the banner.
  var actionError: String?
  private(set) var busy: String?
  /// GitHub's Viewed marks on the files, as the `gh` user.
  let viewed: ViewedFiles

  private let store: HostStore
  private let pullRequests: PullRequestsStore

  init(repo: String, number: Int, store: HostStore, pullRequests: PullRequestsStore) {
    self.repo = repo
    self.number = number
    self.store = store
    self.pullRequests = pullRequests
    viewed = ViewedFiles(scope: .pullRequest(repo: repo, number: number), host: store)
  }

  /// Split at the last slash: a GitLab project's groups all go in `owner`.
  private var owner: String { repo.split(separator: "/").dropLast().joined(separator: "/") }
  private var name: String { String(repo.split(separator: "/").last ?? "") }

  func load() async {
    guard let backend = store.backend else { return }
    do {
      detail = try await backend.request(
        ArgusProtocol.Commands.GetPullRequestDetail.self, .init(owner: owner, repo: name, number: Double(number)))
      loadError = nil
    } catch {
      loadError = HostStore.describe(error)
    }
    // A push since flips viewed files to changed; GitHub decides which.
    if diffLoaded { await viewed.load() }
  }

  /// The diff loads once, when the Files tab first shows.
  func loadDiffIfNeeded() async {
    guard !diffLoaded, let backend = store.backend else { return }
    defer { diffLoaded = true }
    async let marks: Void = viewed.load()
    do {
      let patch = try await backend.request(
        ArgusProtocol.Commands.GetPullRequestDiff.self, .init(owner: owner, repo: name, number: Double(number)))
      files = DiffParser.fileDiffs(patch: patch)
      diffError = nil
    } catch {
      diffError = HostStore.describe(error)
    }
    await marks
  }

  func comment(_ body: String) async -> Bool {
    busy = "Posting comment"
    defer { busy = nil }
    guard await pullRequests.comment(repo: repo, number: number, body: body) else {
      actionError = pullRequests.error
      return false
    }
    await load()
    return true
  }

  func merge(_ strategy: RemoteMergeStrategy) async {
    busy = "Merging"
    defer { busy = nil }
    if await pullRequests.merge(repo: repo, number: number, strategy: strategy) {
      actionError = nil
    } else {
      actionError = pullRequests.error
    }
    await load()
  }

  func close() async {
    guard let backend = store.backend else { return }
    busy = "Closing"
    defer { busy = nil }
    do {
      try await backend.request(
        ArgusProtocol.Commands.GhPrClose.self, .init(owner: owner, repo: name, number: Double(number)))
      actionError = nil
      MacTelemetry.capture(.pullRequestActed(action: .close))
      await pullRequests.refresh()
    } catch {
      actionError = "Couldn't close that pull request — \(HostStore.describe(error))"
      store.report(error, scope: "pull_requests")
    }
    await load()
  }

  func openOnGitHub(_ url: String? = nil) {
    guard let url = url ?? detail?.url else { return }
    PullRequestLinks.open(url, store: store)
  }
}
